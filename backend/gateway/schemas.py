from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


class LocalRuntimeConfig(BaseModel):
    mode: Literal["local"]
    model_path: str = Field(min_length=1, max_length=2048)
    torch_dtype: Literal["float16", "bfloat16"] = "float16"
    low_vram: bool = False


class CloudRuntimeConfig(BaseModel):
    mode: Literal["cloud"]
    ssh_command: str = Field(min_length=1, max_length=1024)
    auth_method: Literal["password", "private_key"] = "password"
    ssh_password: str = Field(default="", max_length=4096)
    ssh_private_key_path: str = Field(default="", max_length=2048)
    ssh_private_key_passphrase: str = Field(default="", max_length=4096)
    remote_api_key: str = Field(min_length=1, max_length=4096)
    remote_port: int = Field(default=6006, ge=1, le=65535)

    @model_validator(mode="after")
    def validate_credentials(self) -> "CloudRuntimeConfig":
        if self.auth_method == "password" and not self.ssh_password:
            raise ValueError("SSH password is required.")
        if self.auth_method == "private_key" and not self.ssh_private_key_path:
            raise ValueError("SSH private key path is required.")
        return self


RuntimeConfig = Annotated[
    LocalRuntimeConfig | CloudRuntimeConfig,
    Field(discriminator="mode"),
]


class DirectoryEntry(BaseModel):
    name: str
    path: str
    kind: Literal["directory", "model_file"]


class DirectoryListing(BaseModel):
    current: str
    parent: str | None
    entries: list[DirectoryEntry]


class RuntimeSnapshot(BaseModel):
    mode: Literal["unconfigured", "local", "cloud"]
    state: Literal["idle", "starting", "ready", "error"]
    label: str
    detail: str = ""
