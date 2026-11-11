import enum
from datetime import datetime
from sqlalchemy import (
    Column,
    BigInteger,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Enum as SQLEnum,
    JSON,
)
from sqlalchemy.orm import relationship
from .database import Base

class RoleEnum(str, enum.Enum):
    ADMIN = "ADMIN"
    ENGINEER = "ENGINEER"
    USER = "USER"

class DataTypeEnum(str, enum.Enum):
    STRING = "STRING"
    INTEGER = "INTEGER"
    NUMBER = "NUMBER"
    BOOLEAN = "BOOLEAN"
    DATE = "DATE"
    ENUM = "ENUM"

class WriteoffStateEnum(str, enum.Enum):
    PREPARING = "PREPARING"
    DOCUMENTS_PREPARATION = "DOCUMENTS_PREPARATION"
    WRITTEN_OFF = "WRITTEN_OFF"

class IssueStateEnum(str, enum.Enum):
    ISSUE = "ISSUE"
    CRITICAL_ISSUE = "CRITICAL_ISSUE"
    WEAR_AND_TEAR = "WEAR_AND_TEAR"

class User(Base):
    __tablename__ = "user"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    login = Column(Text, unique=True, nullable=False, index=True)
    password_hash = Column(Text, nullable=False)
    role = Column(SQLEnum(RoleEnum, name="role_enum"), nullable=False)
    uid = Column(Text, unique=True, nullable=True)

    refresh_token = relationship("RefreshToken", back_populates="user", uselist=False, cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    audits = relationship("Inventory", back_populates="auditor")

class RefreshToken(Base):
    __tablename__ = "refresh_token"

    id = Column(BigInteger, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    token = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    valid_until = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="refresh_token")

class Room(Base):
    __tablename__ = "room"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    number = Column(Text, nullable=False)
    floor = Column(Integer, nullable=False)

    equipment_list = relationship("Equipment", back_populates="room")

class EquipmentType(Base):
    __tablename__ = "equipment_type"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    name = Column(Text, nullable=False)
    parent_id = Column(BigInteger, ForeignKey("equipment_type.id"), nullable=True)

    parent = relationship("EquipmentType", remote_side=[id], backref="children")
    additional_fields = relationship("AdditionalField", back_populates="equipment_type", cascade="all, delete-orphan")
    equipment_list = relationship("Equipment", back_populates="equipment_type")

class AdditionalField(Base):
    __tablename__ = "additional_field"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    type_id = Column(BigInteger, ForeignKey("equipment_type.id", ondelete="CASCADE"), nullable=False)
    code = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    data_type = Column(SQLEnum(DataTypeEnum, name="data_type_enum"), nullable=False)
    is_required = Column(Boolean, default=False, nullable=False)
    is_multiple = Column(Boolean, default=False, nullable=False)
    options = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    equipment_type = relationship("EquipmentType", back_populates="additional_fields")

class Equipment(Base):
    __tablename__ = "equipment"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    inventory_number = Column(Text, unique=True, nullable=False, index=True)
    name = Column(Text, nullable=False)
    type_id = Column(BigInteger, ForeignKey("equipment_type.id"), nullable=False)
    recived = Column(DateTime, nullable=False)
    initial_cost = Column(BigInteger, nullable=False)
    residual_cost = Column(BigInteger, nullable=False)
    room_id = Column(BigInteger, ForeignKey("room.id"), nullable=False)
    additional_fields = Column(JSON, default={}, nullable=False)

    equipment_type = relationship("EquipmentType", back_populates="equipment_list")
    room = relationship("Room", back_populates="equipment_list")
    writeoff = relationship("EquipmentWriteoff", back_populates="equipment", uselist=False, cascade="all, delete-orphan")
    issues = relationship("EquipmentIssue", back_populates="equipment", cascade="all, delete-orphan")
    transfers = relationship("EquipmentTransfer", back_populates="equipment", cascade="all, delete-orphan")
    verifications = relationship("Verification", back_populates="equipment", cascade="all, delete-orphan")

class EquipmentWriteoff(Base):
    __tablename__ = "equipment_writeoff"

    equipment_id = Column(BigInteger, ForeignKey("equipment.id", ondelete="CASCADE"), primary_key=True)
    state = Column(SQLEnum(WriteoffStateEnum, name="writeoff_state_enum"), nullable=False)
    writeoff_date = Column(DateTime, nullable=True)

    equipment = relationship("Equipment", back_populates="writeoff")

class EquipmentIssue(Base):
    __tablename__ = "equipment_issue"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    equipment_id = Column(BigInteger, ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False)
    state = Column(SQLEnum(IssueStateEnum, name="issue_state_enum"), nullable=False)
    description = Column(Text, nullable=False)
    broken_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    repaired_at = Column(DateTime, nullable=True)

    equipment = relationship("Equipment", back_populates="issues")
    notifications = relationship("Notification", back_populates="issue", cascade="all, delete-orphan")

class Notification(Base):
    __tablename__ = "notification"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    equipment_issue_id = Column(BigInteger, ForeignKey("equipment_issue.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="notifications")
    issue = relationship("EquipmentIssue", back_populates="notifications")

class EquipmentTransfer(Base):
    __tablename__ = "equipment_transfer"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    equipment_id = Column(BigInteger, ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False)
    issued_to = Column(Text, nullable=False)
    issued_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expected_return_at = Column(DateTime, nullable=True)
    returned_at = Column(DateTime, nullable=True)

    equipment = relationship("Equipment", back_populates="transfers")

class Inventory(Base):
    __tablename__ = "inventory"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    auditor_ext_id = Column(BigInteger, ForeignKey("user.id"), nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at = Column(DateTime, nullable=True)

    auditor = relationship("User", back_populates="audits")
    verifications = relationship("Verification", back_populates="inventory", cascade="all, delete-orphan")

class Verification(Base):
    __tablename__ = "verification"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    equipment_id = Column(BigInteger, ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False)
    inventory_id = Column(BigInteger, ForeignKey("inventory.id", ondelete="CASCADE"), nullable=False)
    verified_at = Column(DateTime, nullable=True)

    equipment = relationship("Equipment", back_populates="verifications")
    inventory = relationship("Inventory", back_populates="verifications")
