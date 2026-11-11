import io
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, Response, Request, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, desc

from .config import settings
from .database import get_db, engine, Base
from .models import (
    User, RoleEnum, RefreshToken, Room, EquipmentType,
    AdditionalField, Equipment, EquipmentWriteoff,
    EquipmentIssue, Notification, EquipmentTransfer,
    Inventory, Verification, WriteoffStateEnum, DataTypeEnum
)
from .schemas import (
    UserLogin, UserCreate, UserOut, TokenResponse,
    RoomBase, RoomOut, EquipmentTypeBase, EquipmentTypeOut,
    AdditionalFieldBase, AdditionalFieldOut, EquipmentCreate,
    EquipmentUpdate, EquipmentOut, IssueCreate, IssueOut,
    TransferCreate, TransferOut, WriteoffUpdate, InventoryOut
)
from .auth import (
    verify_password, get_password_hash, create_access_token,
    create_refresh_token, get_current_user, require_role
)

app = FastAPI(
    title=settings.APP_NAME,
    description="Высокопроизводительный бэкенд на FastAPI для ИС «Учет материальных ценностей» кафедры",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- AUTH ROUTER -----------------
@app.post("/api/auth/login", response_model=TokenResponse)
def login(payload: UserLogin, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.login == payload.login).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    user_data = {"id": user.id, "login": user.login, "role": user.role.value}
    access_token = create_access_token(user_data)
    refresh_token = create_refresh_token(user_data)

    valid_until = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    # Save refresh token in DB
    existing_token = db.query(RefreshToken).filter(RefreshToken.id == user.id).first()
    if existing_token:
        existing_token.token = refresh_token
        existing_token.valid_until = valid_until
        existing_token.created_at = datetime.utcnow()
    else:
        db.add(RefreshToken(id=user.id, token=refresh_token, valid_until=valid_until))
    db.commit()

    # Set HttpOnly cookie for access_token (120 minutes) as required by specification
    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        samesite="lax",
    )

    return {
        "success": True,
        "user": user,
        "accessToken": access_token,
    }

@app.post("/api/auth/refresh")
def refresh_token(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Отсутствует refresh-токен")

    stored = db.query(RefreshToken).filter(RefreshToken.token == token).first()
    if not stored:
        response.delete_cookie("access_token")
        response.delete_cookie("refresh_token")
        raise HTTPException(status_code=401, detail="Невалидный refresh-токен")

    # If invalid or expired, delete from DB as required by PDF page 1
    if stored.valid_until < datetime.utcnow():
        db.delete(stored)
        db.commit()
        response.delete_cookie("access_token")
        response.delete_cookie("refresh_token")
        raise HTTPException(status_code=401, detail="Срок действия refresh-токена истек")

    user = db.query(User).filter(User.id == stored.id).first()
    if not user:
        db.delete(stored)
        db.commit()
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    user_data = {"id": user.id, "login": user.login, "role": user.role.value}
    new_access_token = create_access_token(user_data)
    new_refresh_token = create_refresh_token(user_data)

    stored.token = new_refresh_token
    stored.valid_until = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    stored.created_at = datetime.utcnow()
    db.commit()

    response.set_cookie(
        key="access_token",
        value=new_access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        samesite="lax",
    )

    return {"success": True, "accessToken": new_access_token, "user": user}

@app.post("/api/auth/logout")
def logout(response: Response, current_user: Optional[User] = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user:
        db.query(RefreshToken).filter(RefreshToken.id == current_user.id).delete()
        db.commit()
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"success": True}

@app.get("/api/auth/me", response_model=dict)
def get_me(current_user: User = Depends(get_current_user)):
    return {"user": current_user}

@app.get("/api/users", response_model=List[UserOut])
def list_users(current_user: User = Depends(require_role(RoleEnum.ADMIN)), db: Session = Depends(get_db)):
    return db.query(User).order_by(User.id).all()

@app.post("/api/users", response_model=UserOut)
def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_role(RoleEnum.ADMIN)),
    db: Session = Depends(get_db)
):
    if db.query(User).filter(User.login == payload.login).first():
        raise HTTPException(status_code=400, detail="Логин уже занят")
    new_user = User(
        login=payload.login,
        password_hash=get_password_hash(payload.password),
        role=payload.role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

# ----------------- ROOMS & TYPES -----------------
@app.get("/api/rooms", response_model=List[RoomOut])
def get_rooms(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Room).order_by(Room.number).all()

@app.post("/api/rooms", response_model=RoomOut)
def create_room(
    payload: RoomBase,
    current_user: User = Depends(require_role(RoleEnum.ADMIN)),
    db: Session = Depends(get_db)
):
    room = Room(number=payload.number, floor=payload.floor)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room

@app.get("/api/equipment-types", response_model=List[EquipmentTypeOut])
def get_equipment_types(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(EquipmentType).order_by(EquipmentType.name).all()

@app.post("/api/equipment-types", response_model=EquipmentTypeOut)
def create_equipment_type(
    payload: EquipmentTypeBase,
    current_user: User = Depends(require_role(RoleEnum.ADMIN)),
    db: Session = Depends(get_db)
):
    eq_type = EquipmentType(name=payload.name, parent_id=payload.parent_id)
    db.add(eq_type)
    db.commit()
    db.refresh(eq_type)
    return eq_type

def get_inherited_fields(type_id: int, db: Session) -> List[AdditionalField]:
    fields = []
    curr_id = type_id
    while curr_id:
        f_list = db.query(AdditionalField).filter(
            AdditionalField.type_id == curr_id,
            AdditionalField.is_active == True
        ).all()
        fields.extend(f_list)
        t = db.query(EquipmentType).filter(EquipmentType.id == curr_id).first()
        curr_id = t.parent_id if t else None
    return fields

@app.get("/api/equipment-types/{type_id}/fields", response_model=List[AdditionalFieldOut])
def get_type_fields(
    type_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return get_inherited_fields(type_id, db)

@app.post("/api/equipment-types/{type_id}/fields", response_model=AdditionalFieldOut)
def add_type_field(
    type_id: int,
    payload: AdditionalFieldBase,
    current_user: User = Depends(require_role(RoleEnum.ADMIN)),
    db: Session = Depends(get_db)
):
    if payload.data_type == DataTypeEnum.ENUM and (not payload.options or len(payload.options) == 0):
        raise HTTPException(status_code=400, detail="Для ENUM обязателен список options")

    existing = db.query(AdditionalField).filter(
        AdditionalField.type_id == type_id,
        AdditionalField.code == payload.code,
        AdditionalField.is_active == True
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Характеристика с таким кодом уже есть для этого типа")

    field = AdditionalField(
        type_id=type_id,
        code=payload.code,
        title=payload.title,
        data_type=payload.data_type,
        is_required=payload.is_required,
        is_multiple=payload.is_multiple,
        options=payload.options if payload.data_type == DataTypeEnum.ENUM else None,
        is_active=True,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field

@app.delete("/api/equipment-types/{type_id}/fields/{field_id}")
def delete_type_field(
    type_id: int,
    field_id: int,
    current_user: User = Depends(require_role(RoleEnum.ADMIN)),
    db: Session = Depends(get_db)
):
    field = db.query(AdditionalField).filter(AdditionalField.id == field_id).first()
    if field:
        field.is_active = False
        db.commit()
    return {"success": True}

# ----------------- EQUIPMENT CRUD -----------------
@app.get("/api/equipment")
def list_equipment(
    page: int = 1,
    limit: int = 15,
    search: Optional[str] = None,
    type_id: Optional[int] = None,
    room_id: Optional[int] = None,
    include_written_off: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Equipment)
    if search:
        query = query.filter(or_(
            Equipment.name.ilike(f"%{search}%"),
            Equipment.inventory_number.ilike(f"%{search}%")
        ))
    if type_id:
        query = query.filter(Equipment.type_id == type_id)
    if room_id:
        query = query.filter(Equipment.room_id == room_id)

    if not include_written_off:
        # Exclude WRITTEN_OFF
        written_off_ids = db.query(EquipmentWriteoff.equipment_id).filter(
            EquipmentWriteoff.state == WriteoffStateEnum.WRITTEN_OFF
        ).subquery()
        query = query.filter(~Equipment.id.in_(written_off_ids))

    total = query.count()
    items = query.order_by(desc(Equipment.id)).offset((page - 1) * limit).limit(limit).all()

    result_items = []
    for item in items:
        wo = db.query(EquipmentWriteoff).filter(EquipmentWriteoff.equipment_id == item.id).first()
        result_items.append({
            "id": item.id,
            "inventory_number": item.inventory_number,
            "name": item.name,
            "type_id": item.type_id,
            "typeName": item.equipment_type.name if item.equipment_type else None,
            "recived": item.recived,
            "initial_cost": item.initial_cost,
            "residual_cost": item.residual_cost,
            "room_id": item.room_id,
            "roomNumber": item.room.number if item.room else None,
            "roomFloor": item.room.floor if item.room else None,
            "additional_fields": item.additional_fields,
            "writeoffState": wo.state if wo and current_user.role != RoleEnum.USER else None,
            "writeoffDate": wo.writeoff_date if wo and current_user.role != RoleEnum.USER else None,
        })

    return {
        "items": result_items,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": (total + limit - 1) // limit or 1
    }

@app.get("/api/equipment/{equipment_id}")
def get_equipment_detail(
    equipment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(Equipment).filter(Equipment.id == equipment_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Оборудование не найдено")

    wo = db.query(EquipmentWriteoff).filter(EquipmentWriteoff.equipment_id == item.id).first()
    active_issues = db.query(EquipmentIssue).filter(
        EquipmentIssue.equipment_id == item.id,
        EquipmentIssue.repaired_at == None
    ).order_by(desc(EquipmentIssue.broken_at)).all()

    active_transfer = db.query(EquipmentTransfer).filter(
        EquipmentTransfer.equipment_id == item.id,
        EquipmentTransfer.returned_at == None
    ).first()

    fields_defs = get_inherited_fields(item.type_id, db)
    is_user = current_user.role == RoleEnum.USER

    return {
        "id": item.id,
        "inventory_number": item.inventory_number,
        "name": item.name,
        "type_id": item.type_id,
        "typeName": item.equipment_type.name if item.equipment_type else None,
        "recived": item.recived,
        "initial_cost": item.initial_cost,
        "residual_cost": item.residual_cost,
        "room_id": item.room_id,
        "roomNumber": item.room.number if item.room else None,
        "roomFloor": item.room.floor if item.room else None,
        "additional_fields": item.additional_fields,
        "writeoffState": wo.state if wo and not is_user else None,
        "writeoffDate": wo.writeoff_date if wo and not is_user else None,
        "activeIssues": active_issues,
        "activeTransfer": active_transfer if not is_user else None,
        "fieldsDefinitions": fields_defs,
    }
