from datetime import datetime, timedelta
import json
import re
import secrets

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer

from pydantic import BaseModel, EmailStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from sqlalchemy import (
    create_engine,
    String,
    Boolean,
    ForeignKey,
    Text,
)

from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    sessionmaker,
    Session,
)

import bcrypt
from jose import jwt


# =========================================================
# CONFIG
# =========================================================

DEV_SECRET = "local-development-secret"


class Settings(BaseSettings):

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # development | production
    ENVIRONMENT: str = "development"

    DATABASE_URL: str = "sqlite:///./app.db"

    # JWT
    SECRET_KEY: str = DEV_SECRET
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_HOURS: int = 8
    VERIFICATION_EXPIRE_MINUTES: int = 30

    # Workspace URLs: {scheme}://{slug}.{BASE_DOMAIN}
    BASE_DOMAIN: str = "localhost:5173"
    URL_SCHEME: str = "http"

    # Public URL of this API (used in SAML ACS URLs and dev verification links)
    API_BASE_URL: str = "http://localhost:8000"

    # CORS: comma-separated origins, plus an optional regex for tenant subdomains
    CORS_ORIGINS: str = "http://localhost:5173"
    CORS_ORIGIN_REGEX: str = ""

    # Return the email-verification link in the register response (dev only)
    EXPOSE_VERIFICATION_URL: bool | None = None


settings = Settings()

IS_PRODUCTION = settings.ENVIRONMENT.lower() == "production"

if IS_PRODUCTION and settings.SECRET_KEY == DEV_SECRET:

    raise RuntimeError(
        "SECRET_KEY must be set to a strong random value in production"
    )

# The app uses a sync engine, so map the async driver to psycopg
DATABASE_URL = (
    settings.DATABASE_URL
    .replace("postgresql+asyncpg://", "postgresql+psycopg://")
    .replace("postgresql://", "postgresql+psycopg://")
    .replace("postgres://", "postgresql+psycopg://")
)

SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.JWT_ALGORITHM

BASE_DOMAIN = settings.BASE_DOMAIN
URL_SCHEME = settings.URL_SCHEME
API_BASE_URL = settings.API_BASE_URL.rstrip("/")

CORS_ORIGINS = [
    o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()
]

CORS_ORIGIN_REGEX = settings.CORS_ORIGIN_REGEX or (
    rf"^{re.escape(URL_SCHEME)}://[a-z0-9-]+\.{re.escape(BASE_DOMAIN)}$"
)

EXPOSE_VERIFICATION_URL = (
    settings.EXPOSE_VERIFICATION_URL
    if settings.EXPOSE_VERIFICATION_URL is not None
    else not IS_PRODUCTION
)


# =========================================================
# DATABASE
# =========================================================

engine = create_engine(
    DATABASE_URL,
    connect_args=(
        {"check_same_thread": False}
        if DATABASE_URL.startswith("sqlite")
        else {}
    ),
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


# =========================================================
# USER
# =========================================================

class User(Base):

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        String(200),
        unique=True,
        index=True,
        nullable=False,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    verification_token: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    verification_expires: Mapped[datetime | None] = mapped_column(
        nullable=True,
    )


# =========================================================
# WORKSPACE
# =========================================================

class Workspace(Base):

    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    slug: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        index=True,
        nullable=False,
    )

    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )

    custom_domain: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
    )


# =========================================================
# WORKSPACE USERS
# =========================================================

class WorkspaceUser(Base):

    __tablename__ = "workspace_users"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id"),
        nullable=False,
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )

    role: Mapped[str] = mapped_column(
        String(30),
        default="owner",
    )

    active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )


# =========================================================
# INVITES
# =========================================================

class Invite(Base):

    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id"),
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        String(200),
        index=True,
        nullable=False,
    )

    role: Mapped[str] = mapped_column(
        String(30),
        default="member",
    )


# =========================================================
# AUTH PROVIDERS (SAML SSO)
# =========================================================

class AuthProvider(Base):

    __tablename__ = "auth_providers"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id"),
        index=True,
        nullable=False,
    )

    provider: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    # JSON text: idp_sso_url, idp_entity_id, certificate
    config: Mapped[str] = mapped_column(
        Text,
        default="{}",
        nullable=False,
    )


# =========================================================
# CREATE TABLES
# =========================================================

# Schema is managed by Alembic: run `alembic upgrade head`


# =========================================================
# DATABASE DEPENDENCY
# =========================================================

def get_db():

    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()


# =========================================================
# PASSWORD / JWT
# =========================================================

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/login"
)


def hash_password(password: str):

    return bcrypt.hashpw(
        password.encode()[:72],
        bcrypt.gensalt(),
    ).decode()


def verify_password(
    password: str,
    password_hash: str,
):

    return bcrypt.checkpw(
        password.encode()[:72],
        password_hash.encode(),
    )


def create_access_token(
    user_id: int,
):

    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow()
        + timedelta(hours=settings.ACCESS_TOKEN_EXPIRE_HOURS),
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


# =========================================================
# CURRENT USER
# =========================================================

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):

    try:

        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )

        user_id = int(
            payload["sub"]
        )

    except Exception:

        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

    user = db.get(
        User,
        user_id,
    )

    if not user:

        raise HTTPException(
            status_code=401,
            detail="User not found",
        )

    return user


def accept_invites(db: Session, user: User):

    invites = (
        db.query(Invite)
        .filter(Invite.email == user.email)
        .all()
    )

    for invite in invites:

        exists = (
            db.query(WorkspaceUser)
            .filter(
                WorkspaceUser.workspace_id == invite.workspace_id,
                WorkspaceUser.user_id == user.id,
            )
            .first()
        )

        if not exists:

            db.add(
                WorkspaceUser(
                    workspace_id=invite.workspace_id,
                    user_id=user.id,
                    role=invite.role,
                )
            )

        db.delete(invite)

    db.commit()


# =========================================================
# FASTAPI
# =========================================================

app = FastAPI(
    title="ContextWeave API",
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,

    allow_origins=CORS_ORIGINS,

    allow_origin_regex=CORS_ORIGIN_REGEX,

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],
)


# =========================================================
# REQUEST SCHEMAS
# =========================================================

class RegisterRequest(BaseModel):

    name: str

    email: EmailStr

    password: str


class LoginRequest(BaseModel):

    email: EmailStr

    password: str


class WorkspaceRequest(BaseModel):

    name: str

    slug: str


# =========================================================
# HEALTH
# =========================================================

@app.get("/api/config")
def public_config():

    return {
        "base_domain": BASE_DOMAIN,
        "url_scheme": URL_SCHEME,
    }


@app.get("/api/health")
def health():

    return {
        "status": "ok",
        "message": "API is running",
    }


# =========================================================
# REGISTER
# =========================================================

@app.post("/api/auth/register")
def register(
    data: RegisterRequest,
    db: Session = Depends(get_db),
):

    email = data.email.lower().strip()

    existing_user = (
        db.query(User)
        .filter(
            User.email == email
        )
        .first()
    )

    if existing_user:

        raise HTTPException(
            status_code=409,
            detail="Email already registered",
        )

    verification_token = (
        secrets.token_urlsafe(32)
    )

    user = User(

        name=data.name.strip(),

        email=email,

        password_hash=hash_password(
            data.password
        ),

        email_verified=False,

        verification_token=verification_token,

        verification_expires=(
            datetime.utcnow()
            + timedelta(minutes=settings.VERIFICATION_EXPIRE_MINUTES)
        ),
    )

    db.add(user)

    db.commit()

    db.refresh(user)

    response = {

        "message":
            "Registration successful. Please verify your email.",

        "user_id":
            user.id,

        "email":
            user.email,
    }

    # Development only: no email is sent, so hand back the link
    if EXPOSE_VERIFICATION_URL:

        response["verification_url"] = (
            f"{API_BASE_URL}/api/auth/verify-email"
            f"?token={verification_token}"
        )

    return response


# =========================================================
# VERIFY EMAIL
# =========================================================

@app.get("/api/auth/verify-email")
def verify_email(
    token: str,
    db: Session = Depends(get_db),
):

    user = (
        db.query(User)
        .filter(
            User.verification_token
            == token
        )
        .first()
    )

    if not user:

        raise HTTPException(
            status_code=400,
            detail="Invalid verification token",
        )

    if not user.verification_expires:

        raise HTTPException(
            status_code=400,
            detail="Verification token expired",
        )

    if (
        user.verification_expires
        < datetime.utcnow()
    ):

        raise HTTPException(
            status_code=400,
            detail="Verification token expired",
        )

    # Verify user

    user.email_verified = True

    user.verification_token = None

    user.verification_expires = None

    db.commit()

    return {

        "message":
            "Email verified successfully",

        "user_id":
            user.id,

        "email":
            user.email,

        "next_step":
            "Please login and create your workspace.",
    }


# =========================================================
# LOGIN
# =========================================================

@app.post("/api/auth/login")
def login(
    data: LoginRequest,
    db: Session = Depends(get_db),
):

    email = data.email.lower().strip()

    user = (
        db.query(User)
        .filter(
            User.email == email
        )
        .first()
    )

    if not user:

        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    if not verify_password(
        data.password,
        user.password_hash,
    ):

        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    # Email must be verified

    if not user.email_verified:

        raise HTTPException(
            status_code=403,
            detail="Please verify your email first",
        )

    accept_invites(db, user)

    access_token = (
        create_access_token(
            user.id
        )
    )

    return {

        "access_token":
            access_token,

        "token_type":
            "bearer",

        "user": {

            "id":
                user.id,

            "name":
                user.name,

            "email":
                user.email,

            "email_verified":
                user.email_verified,
        },

        "next_step":
            "Create your workspace.",
    }


# =========================================================
# CURRENT USER
# =========================================================

@app.get("/api/auth/me")
def get_me(
    user: User = Depends(
        get_current_user
    ),
):

    return {

        "id":
            user.id,

        "name":
            user.name,

        "email":
            user.email,

        "email_verified":
            user.email_verified,
    }


# =========================================================
# CREATE WORKSPACE
# =========================================================

@app.post("/api/workspaces")
def create_workspace(

    data: WorkspaceRequest,

    user: User = Depends(
        get_current_user
    ),

    db: Session = Depends(
        get_db
    ),
):

    # Email must be verified

    if not user.email_verified:

        raise HTTPException(
            status_code=403,
            detail="Please verify your email first",
        )

    # Clean values

    workspace_name = data.name.strip()

    slug = (
        data.slug
        .lower()
        .strip()
    )

    if not workspace_name:

        raise HTTPException(
            status_code=400,
            detail="Workspace name is required",
        )

    if not slug:

        raise HTTPException(
            status_code=400,
            detail="Workspace URL is required",
        )

    # Basic slug validation

    if not slug.replace(
        "-",
        "",
    ).isalnum():

        raise HTTPException(
            status_code=400,
            detail=(
                "Workspace URL can contain "
                "letters, numbers and hyphens only"
            ),
        )

    # Check workspace URL

    existing_workspace = (
        db.query(Workspace)
        .filter(
            Workspace.slug == slug
        )
        .first()
    )

    if existing_workspace:

        raise HTTPException(
            status_code=409,
            detail="Workspace URL already exists",
        )

    # Create workspace

    workspace = Workspace(

        name=workspace_name,

        slug=slug,

        owner_id=user.id,
    )

    db.add(workspace)

    db.commit()

    db.refresh(workspace)

    # Add owner to workspace

    membership = WorkspaceUser(

        workspace_id=workspace.id,

        user_id=user.id,

        role="owner",
    )

    db.add(membership)

    db.commit()

    return {

        "message":
            "Workspace created successfully",

        "workspace": {

            "id":
                workspace.id,

            "name":
                workspace.name,

            "slug":
                workspace.slug,

            "role":
                "owner",

            "url":
                f"{URL_SCHEME}://{workspace.slug}.{BASE_DOMAIN}",
        },

    }


# =========================================================
# GET MY WORKSPACES
# =========================================================

@app.get("/api/workspaces")
def get_my_workspaces(

    user: User = Depends(
        get_current_user
    ),

    db: Session = Depends(
        get_db
    ),
):

    memberships = (

        db.query(WorkspaceUser)

        .filter(
            WorkspaceUser.user_id
            == user.id,
            WorkspaceUser.active.is_(True),
        )

        .all()
    )

    result = []

    for membership in memberships:

        workspace = db.get(
            Workspace,
            membership.workspace_id,
        )

        if workspace:

            result.append({

                "workspace_id":
                    workspace.id,

                "name":
                    workspace.name,

                "slug":
                    workspace.slug,

                "role":
                    membership.role,

                "url":
                    f"{URL_SCHEME}://{workspace.slug}.{BASE_DOMAIN}",
            })

    return result

# =========================================================
# CHECK WORKSPACE URL AVAILABILITY
# =========================================================

RESERVED_SLUGS = {
    "www", "api", "app", "admin", "mail", "ftp", "static",
    "assets", "support", "help", "status", "login", "auth",
}


def validate_slug(slug: str):

    if len(slug) < 3 or len(slug) > 40:

        return "Use 3 to 40 characters"

    if not slug.replace("-", "").isalnum() or not slug.isascii():

        return "Only letters, numbers and hyphens are allowed"

    if slug.startswith("-") or slug.endswith("-") or "--" in slug:

        return "Cannot start or end with a hyphen or contain '--'"

    if slug in RESERVED_SLUGS:

        return "This name is reserved"

    return None


@app.get("/api/workspaces/check-slug")
def check_slug(
    slug: str,
    workspace_id: int | None = None,
    db: Session = Depends(get_db),
):

    slug = slug.lower().strip()

    reason = validate_slug(slug)

    taken = (
        reason is None
        and db.query(Workspace)
        .filter(Workspace.slug == slug)
        .filter(Workspace.id != (workspace_id or 0))
        .first()
        is not None
    )

    if taken:

        reason = "This address is already taken"

    return {
        "slug": slug,
        "valid": reason is None or taken,
        "available": reason is None,
        "reason": reason,
    }


class SlugRequest(BaseModel):

    slug: str


@app.put("/api/workspaces/{workspace_id}/slug")
def change_slug(
    workspace_id: int,
    data: SlugRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    slug = data.slug.lower().strip()

    reason = validate_slug(slug)

    if reason:

        raise HTTPException(status_code=400, detail=reason)

    if slug != workspace.slug:

        taken = (
            db.query(Workspace)
            .filter(Workspace.slug == slug)
            .first()
        )

        if taken:

            raise HTTPException(
                status_code=409,
                detail="This address is already taken",
            )

        workspace.slug = slug

        db.commit()

    return {
        "slug": workspace.slug,
        "url": f"{URL_SCHEME}://{workspace.slug}.{BASE_DOMAIN}",
    }


# =========================================================
# RESOLVE WORKSPACE BY SUBDOMAIN
# =========================================================

@app.get("/api/workspaces/by-slug/{slug}")
def get_workspace_by_slug(
    slug: str,
    db: Session = Depends(get_db),
):

    workspace = (
        db.query(Workspace)
        .filter(Workspace.slug == slug.lower().strip())
        .first()
    )

    if not workspace:

        raise HTTPException(
            status_code=404,
            detail="Workspace not found",
        )

    return {
        "id": workspace.id,
        "name": workspace.name,
        "slug": workspace.slug,
    }


# =========================================================
# WORKSPACE ADMIN (INVITES / CUSTOM DOMAIN)
# =========================================================

INVITE_ROLES = (
    "platform_admin",
    "domain_architect",
    "data_steward",
    "compliance_auditor",
    "business_user",
)


class InviteRequest(BaseModel):

    email: EmailStr

    role: str = "business_user"


class DomainRequest(BaseModel):

    domain: str


def get_owned_workspace(
    workspace_id: int,
    user: User,
    db: Session,
):

    membership = (
        db.query(WorkspaceUser)
        .filter(
            WorkspaceUser.workspace_id == workspace_id,
            WorkspaceUser.user_id == user.id,
        )
        .first()
    )

    workspace = db.get(Workspace, workspace_id)

    if not workspace or not membership:

        raise HTTPException(
            status_code=404,
            detail="Workspace not found",
        )

    if membership.role != "owner":

        raise HTTPException(
            status_code=403,
            detail="Only the workspace owner can do this",
        )

    return workspace


@app.get("/api/workspaces/{workspace_id}/users")
def list_workspace_users(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    members = (
        db.query(WorkspaceUser, User)
        .join(User, User.id == WorkspaceUser.user_id)
        .filter(WorkspaceUser.workspace_id == workspace.id)
        .all()
    )

    invites = (
        db.query(Invite)
        .filter(Invite.workspace_id == workspace.id)
        .all()
    )

    return {
        "members": [
            {
                "user_id": u.id,
                "name": u.name,
                "email": u.email,
                "role": m.role,
                "active": m.active,
            }
            for m, u in members
        ],
        "invites": [
            {"id": i.id, "email": i.email, "role": i.role}
            for i in invites
        ],
    }


@app.post("/api/workspaces/{workspace_id}/invites")
def invite_user(
    workspace_id: int,
    data: InviteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    email = data.email.lower().strip()

    if data.role not in INVITE_ROLES:

        raise HTTPException(
            status_code=400,
            detail="Invalid role",
        )

    existing_user = (
        db.query(User).filter(User.email == email).first()
    )

    if existing_user and (
        db.query(WorkspaceUser)
        .filter(
            WorkspaceUser.workspace_id == workspace.id,
            WorkspaceUser.user_id == existing_user.id,
        )
        .first()
    ):

        raise HTTPException(
            status_code=409,
            detail="User is already a member",
        )

    if (
        db.query(Invite)
        .filter(
            Invite.workspace_id == workspace.id,
            Invite.email == email,
        )
        .first()
    ):

        raise HTTPException(
            status_code=409,
            detail="User is already invited",
        )

    db.add(
        Invite(
            workspace_id=workspace.id,
            email=email,
            role=data.role,
        )
    )

    db.commit()

    return {"message": "Invite created", "email": email}


@app.delete("/api/workspaces/{workspace_id}/invites/{invite_id}")
def revoke_invite(
    workspace_id: int,
    invite_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    invite = db.get(Invite, invite_id)

    if not invite or invite.workspace_id != workspace.id:

        raise HTTPException(
            status_code=404,
            detail="Invite not found",
        )

    db.delete(invite)

    db.commit()

    return {"message": "Invite revoked"}


def domain_info(workspace: Workspace):

    return {
        "domain": workspace.custom_domain,
        "cname_host": workspace.custom_domain,
        "cname_target": f"{workspace.slug}.{BASE_DOMAIN.split(':')[0]}",
    }


@app.get("/api/workspaces/{workspace_id}/domain")
def get_domain(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    return domain_info(get_owned_workspace(workspace_id, user, db))


@app.put("/api/workspaces/{workspace_id}/domain")
def set_domain(
    workspace_id: int,
    data: DomainRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    domain = data.domain.lower().strip().rstrip(".")

    labels = domain.split(".")

    if (
        len(labels) < 2
        or any(
            not l or not l.replace("-", "").isalnum()
            for l in labels
        )
    ):

        raise HTTPException(
            status_code=400,
            detail="Enter a valid domain, e.g. app.example.com",
        )

    taken = (
        db.query(Workspace)
        .filter(
            Workspace.custom_domain == domain,
            Workspace.id != workspace.id,
        )
        .first()
    )

    if taken:

        raise HTTPException(
            status_code=409,
            detail="Domain is already used by another workspace",
        )

    workspace.custom_domain = domain

    db.commit()

    return domain_info(workspace)


# =========================================================
# SAML AUTH PROVIDERS
# =========================================================

SAML_PROVIDERS = [
    {
        "key": "azure_ad",
        "name": "Microsoft Entra ID (Azure AD)",
        "description": "Single sign-on with your Microsoft work accounts.",
    },
    {
        "key": "okta",
        "name": "Okta",
        "description": "Single sign-on with Okta.",
    },
    {
        "key": "google_workspace",
        "name": "Google Workspace",
        "description": "Single sign-on with Google Workspace accounts.",
    },
    {
        "key": "onelogin",
        "name": "OneLogin",
        "description": "Single sign-on with OneLogin.",
    },
    {
        "key": "auth0",
        "name": "Auth0",
        "description": "Single sign-on with Auth0.",
    },
    {
        "key": "saml",
        "name": "Other SAML 2.0",
        "description": "Any identity provider that supports SAML 2.0.",
    },
]

SAML_FIELDS = ("idp_sso_url", "idp_entity_id", "certificate")


class ProviderRequest(BaseModel):

    enabled: bool

    idp_sso_url: str = ""

    idp_entity_id: str = ""

    certificate: str = ""


def provider_view(workspace: Workspace, key: str, row: AuthProvider | None):

    config = json.loads(row.config) if row else {}

    return {
        "enabled": bool(row and row.enabled),
        "config": {f: config.get(f, "") for f in SAML_FIELDS},
        "sp": {
            "entity_id": f"{URL_SCHEME}://{workspace.slug}.{BASE_DOMAIN}/saml/metadata",
            "acs_url": f"{API_BASE_URL}/api/auth/saml/{workspace.slug}/{key}/acs",
        },
    }


@app.get("/api/workspaces/{workspace_id}/auth-providers")
def list_auth_providers(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    rows = {
        r.provider: r
        for r in db.query(AuthProvider)
        .filter(AuthProvider.workspace_id == workspace.id)
        .all()
    }

    return [
        {**meta, **provider_view(workspace, meta["key"], rows.get(meta["key"]))}
        for meta in SAML_PROVIDERS
    ]


@app.put("/api/workspaces/{workspace_id}/auth-providers/{provider}")
def save_auth_provider(
    workspace_id: int,
    provider: str,
    data: ProviderRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    meta = next((m for m in SAML_PROVIDERS if m["key"] == provider), None)

    if not meta:

        raise HTTPException(
            status_code=404,
            detail="Unknown provider",
        )

    sso_url = data.idp_sso_url.strip()

    if data.enabled and (
        not sso_url.startswith("https://")
        or not data.idp_entity_id.strip()
        or not data.certificate.strip()
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "To enable a provider, fill in the HTTPS "
                "SSO URL, Entity ID and certificate"
            ),
        )

    row = (
        db.query(AuthProvider)
        .filter(
            AuthProvider.workspace_id == workspace.id,
            AuthProvider.provider == provider,
        )
        .first()
    )

    if not row:

        row = AuthProvider(
            workspace_id=workspace.id,
            provider=provider,
        )

        db.add(row)

    row.enabled = data.enabled

    row.config = json.dumps(
        {
            "idp_sso_url": sso_url,
            "idp_entity_id": data.idp_entity_id.strip(),
            "certificate": data.certificate.strip(),
        }
    )

    db.commit()

    return {**meta, **provider_view(workspace, provider, row)}


# =========================================================
# EDIT / REMOVE USER
# =========================================================

class UserUpdate(BaseModel):

    name: str | None = None

    role: str | None = None

    active: bool | None = None


def get_membership(
    workspace: Workspace,
    user_id: int,
    db: Session,
):

    membership = (
        db.query(WorkspaceUser)
        .filter(
            WorkspaceUser.workspace_id == workspace.id,
            WorkspaceUser.user_id == user_id,
        )
        .first()
    )

    if not membership:

        raise HTTPException(
            status_code=404,
            detail="User not found in this workspace",
        )

    return membership


@app.patch("/api/workspaces/{workspace_id}/users/{user_id}")
def update_workspace_user(
    workspace_id: int,
    user_id: int,
    data: UserUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    membership = get_membership(workspace, user_id, db)

    is_owner = membership.role == "owner"

    if data.name is not None:

        name = data.name.strip()

        if not name:

            raise HTTPException(
                status_code=400,
                detail="Name is required",
            )

        target = db.get(User, user_id)

        target.name = name

    if data.role is not None and data.role != membership.role:

        if is_owner:

            raise HTTPException(
                status_code=400,
                detail="The owner's role cannot be changed",
            )

        if data.role not in INVITE_ROLES:

            raise HTTPException(
                status_code=400,
                detail="Invalid role",
            )

        membership.role = data.role

    if data.active is not None and data.active != membership.active:

        if is_owner:

            raise HTTPException(
                status_code=400,
                detail="The workspace owner cannot be deactivated",
            )

        membership.active = data.active

    db.commit()

    return {
        "user_id": user_id,
        "role": membership.role,
        "active": membership.active,
    }


@app.delete("/api/workspaces/{workspace_id}/users/{user_id}")
def remove_workspace_user(
    workspace_id: int,
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    workspace = get_owned_workspace(workspace_id, user, db)

    membership = get_membership(workspace, user_id, db)

    if membership.role == "owner":

        raise HTTPException(
            status_code=400,
            detail="The workspace owner cannot be removed",
        )

    db.delete(membership)

    db.commit()

    return {"message": "User removed"}
