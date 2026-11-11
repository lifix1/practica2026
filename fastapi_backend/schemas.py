from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from .models import RoleEnum, DataTypeEnum, WriteoffStateEnum, IssueStateEnum

# Auth
class UserLogin(BaseModel):
    login: str
    password: str

class UserCreate(BaseModel):
    login: str
    password: str
    role: RoleEnum

class UserOut(BaseModel):
    id: int
    login: str
    role: RoleEnum

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    success: bool
    user: UserOut
    accessToken: str

# Room
class RoomBase(BaseModel):
    number: str
    floor: int

class RoomOut(RoomBase):
    id: int

    class Config:
        from_attributes = True

# Equipment Type & Additional Fields
class AdditionalFieldBase(BaseModel):
    code: str
    title: str
    data_type: DataTypeEnum
    is_required: bool = False
    is_multiple: bool = False
    options: Optional[List[str]] = None

class AdditionalFieldOut(AdditionalFieldBase):
    id: int
    type_id: int
    is_active: bool

    class Config:
        from_attributes = True

class EquipmentTypeBase(BaseModel):
    name: str
    parent_id: Optional[int] = None

class EquipmentTypeOut(EquipmentTypeBase):
    id: int

    class Config:
        from_attributes = True

# Equipment
class EquipmentBase(BaseModel):
    inventory_number: str
    name: str
    type_id: int
    recived: datetime
    initial_cost: int
    residual_cost: int
    room_id: int
    additional_fields: Dict[str, Any] = Field(default_factory=dict)

class EquipmentCreate(EquipmentBase):
    pass

class EquipmentUpdate(BaseModel):
    inventory_number: Optional[str] = None
    name: Optional[str] = None
    type_id: Optional[int] = None
    recived: Optional[datetime] = None
    initial_cost: Optional[int] = None
    residual_cost: Optional[int] = None
    room_id: Optional[int] = None
    additional_fields: Optional[Dict[str, Any]] = None

class EquipmentOut(EquipmentBase):
    id: int
    typeName: Optional[str] = None
    roomNumber: Optional[str] = None
    roomFloor: Optional[int] = None
    writeoffState: Optional[WriteoffStateEnum] = None
    writeoffDate: Optional[datetime] = None

    class Config:
        from_attributes = True

# Issues
class IssueCreate(BaseModel):
    state: IssueStateEnum
    description: str
    broken_at: Optional[datetime] = None

class IssueOut(BaseModel):
    id: int
    equipment_id: int
    state: IssueStateEnum
    description: str
    broken_at: datetime
    repaired_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# Transfers
class TransferCreate(BaseModel):
    equipment_ids: List[int]
    issued_to: str
    issued_at: Optional[datetime] = None
    expected_return_at: Optional[datetime] = None

class TransferOut(BaseModel):
    id: int
    equipment_id: int
    issued_to: str
    issued_at: datetime
    expected_return_at: Optional[datetime] = None
    returned_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# Writeoff
class WriteoffUpdate(BaseModel):
    equipment_ids: List[int]
    state: WriteoffStateEnum
    writeoff_date: Optional[datetime] = None

# Inventory
class InventoryOut(BaseModel):
    id: int
    auditor_ext_id: int
    started_at: datetime
    finished_at: Optional[datetime] = None

    class Config:
        from_attributes = True
