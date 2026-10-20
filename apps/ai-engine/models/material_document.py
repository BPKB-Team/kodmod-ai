"""Versioned, bounded scientific material AST. No executable HTML or file URLs."""

import json
import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictNode(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


def safe_text(value: str) -> str:
    if re.search(r"<\s*/?\s*[a-zA-Z][^>]*>|<!--", value) or "\x00" in value:
        raise ValueError("HTML is not material text")
    return value


def safe_latex(value: str) -> str:
    # KaTeX subset only. Ban macros that load files, define commands, or construct HTML.
    allowed = set(
        "frac dfrac tfrac sqrt sum prod int lim sin cos tan log ln exp pi theta alpha beta gamma delta epsilon lambda mu sigma omega Delta Omega Gamma left right cdot times div pm mp le ge leq geq neq approx infty in notin subset subseteq cup cap to overline underline vec hat bar text mathrm mathbf mathit operatorname begin end matrix pmatrix bmatrix aligned cases quad qquad displaystyle small tiny degrees circ binom boxed hline".split()
    )
    commands = re.findall(r"\\([a-zA-Z]+)", value)
    if any(command not in allowed for command in commands) or re.search(
        r"(?:https?://|javascript:|<|>)", value, re.I
    ):
        raise ValueError("Unsupported LaTeX command")
    if value.count("{") != value.count("}"):
        raise ValueError("Unbalanced formula")
    return value


class MaterialInline(StrictNode):
    type: Literal["text", "math"] = "text"
    text: str = Field(default="", max_length=100000)
    latex: str | None = Field(default=None, max_length=4000)
    marks: list[Literal["strong", "emphasis", "subscript", "superscript"]] = Field(
        default_factory=list, max_length=4
    )
    href: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_inline(self):
        safe_text(self.text)
        if self.type == "math":
            if not self.latex or self.text or self.marks or self.href:
                raise ValueError("Math inline needs only latex")
            safe_latex(self.latex)
        elif self.latex is not None:
            raise ValueError("Text inline cannot contain latex")
        if len(set(self.marks)) != len(self.marks) or {"subscript", "superscript"}.issubset(
            self.marks
        ):
            raise ValueError("Invalid marks")
        if self.href:
            from urllib.parse import urlsplit

            url = urlsplit(self.href)
            if (
                url.scheme not in ("https", "http")
                or not url.hostname
                or url.username
                or url.password
            ):
                raise ValueError("Only public http(s) links")
        return self


class MaterialProvenance(StrictNode):
    source_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    import_id: uuid.UUID | None = None
    page: int | None = Field(default=None, ge=1, le=500)
    page_label: str | None = Field(default=None, max_length=40)
    bbox: tuple[float, float, float, float] | None = None
    source_block_id: str | None = Field(default=None, max_length=100)
    method: Literal["teacher", "legacy", "native", "table", "ocr", "vision"] = "teacher"
    extractor_version: str = Field(default="document-v1", max_length=60)
    edited: bool = False

    @field_validator("bbox")
    @classmethod
    def valid_box(cls, value):
        import math

        if value and (
            not all(math.isfinite(x) and x >= 0 for x in value)
            or value[2] <= value[0]
            or value[3] <= value[1]
        ):
            raise ValueError("Invalid source region")
        return value


class MaterialBlock(StrictNode):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    type: Literal["heading", "paragraph", "list", "table", "image", "math"]
    role: Literal[
        "instruction", "example", "exercise", "answer_key", "frontmatter", "reference"
    ] = "instruction"
    review_state: Literal["accepted", "needs_review", "excluded"] = "accepted"
    review_origin: Literal["teacher", "extracted", "legacy_unverified"] = "teacher"
    confidence: float | None = Field(default=None, ge=0, le=1)
    provenance: MaterialProvenance = Field(default_factory=MaterialProvenance)
    inlines: list[MaterialInline] = Field(default_factory=list, max_length=10000)
    level: int | None = Field(default=None, ge=1, le=6)
    ordered: bool = False
    items: list[list[MaterialInline]] = Field(default_factory=list, max_length=1000)
    headers: list[str] = Field(default_factory=list, max_length=100)
    rows: list[list[str]] = Field(default_factory=list, max_length=5000)
    asset_id: uuid.UUID | None = None
    alt: str = Field(default="", max_length=4000)
    caption: str = Field(default="", max_length=4000)
    decorative: bool = False
    latex: str | None = Field(default=None, max_length=4000)
    warnings: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def node_shape(self):
        for text in [
            self.alt,
            self.caption,
            *self.headers,
            *[cell for row in self.rows for cell in row],
            *self.warnings,
        ]:
            safe_text(text)
        permitted = {
            "heading": {"inlines", "level"},
            "paragraph": {"inlines"},
            "list": {"items", "ordered"},
            "table": {"headers", "rows"},
            "image": {"asset_id", "alt", "caption", "decorative"},
            "math": {"latex"},
        }[self.type]
        payload = {
            "inlines": self.inlines,
            "level": self.level,
            "ordered": self.ordered,
            "items": self.items,
            "headers": self.headers,
            "rows": self.rows,
            "asset_id": self.asset_id,
            "alt": self.alt,
            "caption": self.caption,
            "decorative": self.decorative,
            "latex": self.latex,
        }
        if any(value and key not in permitted for key, value in payload.items()):
            raise ValueError("Fields do not match block type")
        if self.type in ("paragraph", "heading") and not self.inlines:
            raise ValueError("Text block needs inlines")
        if self.type == "table" and (
            not self.headers or any(len(row) != len(self.headers) for row in self.rows)
        ):
            raise ValueError("Table rows must match headers")
        if self.type == "image" and (
            not self.asset_id
            or (self.review_state == "accepted" and not self.decorative and not self.alt.strip())
        ):
            raise ValueError("Image needs private asset and reviewed alternative text")
        if self.type == "math":
            if not self.latex:
                raise ValueError("Formula required")
            safe_latex(self.latex)
        return self


class MaterialDocument(StrictNode):
    schema_version: Literal[1] = 1
    blocks: list[MaterialBlock] = Field(max_length=5000)

    @model_validator(mode="before")
    @classmethod
    def bounded_json(cls, value):
        if not isinstance(value, dict):
            return value

        def depth(node, current=0):
            if current > 12:
                raise ValueError("Document too deep")
            if isinstance(node, dict):
                for item in node.values():
                    depth(item, current + 1)
            elif isinstance(node, list):
                for item in node:
                    depth(item, current + 1)

        depth(value)
        if (
            len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))
            > 2 * 1024 * 1024
        ):
            raise ValueError("Document too large")
        return value

    @model_validator(mode="after")
    def unique_bounded_content(self):
        if len({b.id for b in self.blocks}) != len(self.blocks):
            raise ValueError("Duplicate block ID")
        # Local import avoids module initialization cycle; includes excluded display text.
        from api.material_document import block_text

        if sum(len(block_text(b)) for b in self.blocks) > 100000:
            raise ValueError("Material text exceeds 100000 characters")
        return self
