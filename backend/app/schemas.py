from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


AvatarId = Literal["lia", "asuna"]
BatchStatus = Literal["queued", "translating", "done", "error"]


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    avatar: AvatarId = "lia"


class RoomFinish(BaseModel):
    duration_seconds: int = Field(default=0, ge=0, le=604800)


class BatchCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class BatchUpdate(BaseModel):
    status: BatchStatus
    error_message: str | None = Field(default=None, max_length=2000)
    gloss_text: str | None = Field(default=None, max_length=2000)
    prompt_id: UUID | None = None
    model: str | None = Field(default=None, max_length=80)
    agent_latency_ms: int | None = Field(default=None, ge=0)


class BatchOut(BaseModel):
    id: UUID
    room_id: UUID
    sequence: int
    text: str
    word_count: int
    status: str
    error_message: str | None
    gloss_text: str | None = None
    prompt_id: UUID | None = None
    model: str | None = None
    agent_latency_ms: int | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class RoomOut(BaseModel):
    id: UUID
    name: str
    avatar: str
    status: str
    started_at: datetime | None
    ended_at: datetime | None
    duration_seconds: int
    created_at: datetime
    updated_at: datetime
    batch_count: int = 0


class RoomDetail(RoomOut):
    batches: list[BatchOut]


class AgentTranslateIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    batch_id: UUID | None = None


class PromptCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    instructions: str = Field(min_length=20, max_length=20000)
    activate: bool = True


class QualityRunCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class QualityRatingCreate(BaseModel):
    output: Literal["video", "avatar", "comparison"]
    score: int = Field(ge=1, le=5)
    notes: str | None = Field(default=None, max_length=4000)
