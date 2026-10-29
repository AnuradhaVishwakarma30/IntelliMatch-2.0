import os

import re

from datetime import date, datetime, timedelta, timezone

import jwt

import psycopg

from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Depends

from fastapi.middleware.cors import CORSMiddleware

from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from fastapi.staticfiles import StaticFiles

from fastapi.responses import FileResponse

from pydantic import BaseModel, Field

from typing import Literal

from pwdlib import PasswordHash

from psycopg.errors import UniqueViolation

load_dotenv()

app = FastAPI(title="IntelliMatch 2.0 API")

app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(

    CORSMiddleware,

    allow_origins=[

        "http://127.0.0.1:5500",

        "http://localhost:5500",

    ],

    allow_methods=["*"],

    allow_headers=["*"],

)

password_hasher = PasswordHash.recommended()

bearer_scheme = HTTPBearer(auto_error=False)

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

JWT_ALGORITHM = "HS256"

TOKEN_EXPIRE_MINUTES = 60 * 24

def get_connection():

    return psycopg.connect(

        host=os.getenv("DB_HOST", "localhost"),

        port=os.getenv("DB_PORT", "5432"),

        dbname=os.getenv("DB_NAME", "intellimatch"),

        user=os.getenv("DB_USER", "postgres"),

        password=os.getenv("DB_PASSWORD"),

    )

def create_access_token(student_id: int) -> str:

    if not JWT_SECRET_KEY:

        raise HTTPException(

            status_code=500,

            detail="JWT_SECRET_KEY is missing from .env.",

        )

    now = datetime.now(timezone.utc)

    payload = {

        "sub": str(student_id),

        "iat": now,

        "exp": now + timedelta(minutes=TOKEN_EXPIRE_MINUTES),

    }

    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

def get_current_student(

    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),

):

    if not credentials or not JWT_SECRET_KEY:

        raise HTTPException(

            status_code=401,

            detail="Please log in to access this resource.",

            headers={"WWW-Authenticate": "Bearer"},

        )

    try:

        payload = jwt.decode(

            credentials.credentials,

            JWT_SECRET_KEY,

            algorithms=[JWT_ALGORITHM],

        )

        student_id = int(payload["sub"])

    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):

        raise HTTPException(

            status_code=401,

            detail="Invalid or expired login token. Please log in again.",

            headers={"WWW-Authenticate": "Bearer"},

        )

    try:

        with get_connection() as conn:

            row = conn.execute(

                """

                SELECT s.student_id, s.full_name, s.email,

                       s.academic_year, s.department_id,

                       s.weekly_availability_hours, a.is_active

                FROM student s

                JOIN student_account a ON a.student_id = s.student_id

                WHERE s.student_id = %s

                """,

                (student_id,),

            ).fetchone()

    except Exception:

        raise HTTPException(status_code=503, detail="Database unavailable.")

    if not row or not row[6]:

        raise HTTPException(status_code=401, detail="Account is unavailable.")

    return {

        "student_id": row[0],

        "full_name": row[1],

        "email": row[2],

        "academic_year": row[3],

        "department_id": row[4],

        "weekly_availability_hours": row[5],

    }

class RegisterRequest(BaseModel):

    full_name: str = Field(min_length=2, max_length=150)

    email: str = Field(min_length=5, max_length=254)

    password: str = Field(min_length=8, max_length=128)

    academic_year: int = Field(ge=1, le=6)

    department_id: int | None = Field(default=None, ge=1)

    weekly_availability_hours: int = Field(default=5, ge=0, le=100)

class LoginRequest(BaseModel):

    email: str = Field(min_length=5, max_length=254)

    password: str = Field(min_length=1, max_length=128)

class SkillSelection(BaseModel):

    skill_id: int = Field(ge=1)

    proficiency: Literal["Beginner", "Intermediate", "Advanced"]

    experience_months: int = Field(default=0, ge=0, le=600)

class SkillsUpdate(BaseModel):

    skills: list[SkillSelection] = Field(max_length=50)

class InterestsUpdate(BaseModel):

    interest_ids: list[int] = Field(max_length=30)

class ProfileUpdate(BaseModel):

    full_name: str = Field(min_length=2, max_length=150)

    academic_year: int = Field(ge=1, le=6)

    department_id: int | None = Field(default=None, ge=1)

    weekly_availability_hours: int = Field(ge=0, le=100)


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=5000)
    project_type: str = Field(min_length=2, max_length=100)
    domain: str = Field(min_length=2, max_length=100)
    team_size_min: int = Field(default=2, ge=1, le=100)
    team_size_max: int = Field(default=4, ge=1, le=100)
    deadline: date | None = None


class ProjectApplicationRequest(BaseModel):
    project_id: int = Field(ge=1)


class ApplicationReviewRequest(BaseModel):
    status: Literal["Accepted", "Rejected"]

@app.get("/")

def home():

    return {

        "message": "IntelliMatch 2.0 API is running",

        "docs": "/docs",

        "app": "/app",

    }

@app.get("/app")

def frontend():

    return FileResponse("static/index.html")

@app.get("/api/health")

def health():

    try:

        with get_connection() as conn:

            conn.execute("SELECT 1")

        return {"status": "ok", "database": "connected"}

    except Exception:

        raise HTTPException(

            status_code=503,

            detail="Database connection failed. Check local .env settings.",

        )

@app.post("/api/auth/register", status_code=201)

def register(data: RegisterRequest):

    full_name = data.full_name.strip()

    email = data.email.strip().lower()

    if len(full_name) < 2:

        raise HTTPException(status_code=422, detail="Enter a valid full name.")

    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):

        raise HTTPException(status_code=422, detail="Enter a valid email address.")

    password_hash = password_hasher.hash(data.password)

    try:

        with get_connection() as conn:

            student = conn.execute(

                """

                INSERT INTO student

                    (full_name, email, academic_year, department_id,

                     weekly_availability_hours)

                VALUES (%s, %s, %s, %s, %s)

                RETURNING student_id, full_name, email

                """,

                (

                    full_name,

                    email,

                    data.academic_year,

                    data.department_id,

                    data.weekly_availability_hours,

                ),

            ).fetchone()

            conn.execute(

                """

                INSERT INTO student_account (student_id, password_hash)

                VALUES (%s, %s)

                """,

                (student[0], password_hash),

            )

        return {

            "message": "Registration successful. You can now log in.",

            "student": {

                "student_id": student[0],

                "full_name": student[1],

                "email": student[2],

            },

        }

    except UniqueViolation:

        raise HTTPException(

            status_code=409,

            detail="This email is already registered. Try logging in.",

        )

    except psycopg.errors.ForeignKeyViolation:

        raise HTTPException(

            status_code=422,

            detail="The selected department does not exist.",

        )

    except HTTPException:

        raise

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Registration failed. Check the database configuration.",

        )

@app.post("/api/auth/login")

def login(data: LoginRequest):

    email = data.email.strip().lower()

    try:

        with get_connection() as conn:

            row = conn.execute(

                """

                SELECT s.student_id, a.password_hash, a.is_active

                FROM student s

                JOIN student_account a ON a.student_id = s.student_id

                WHERE LOWER(s.email) = %s

                """,

                (email,),

            ).fetchone()

    except Exception:

        raise HTTPException(status_code=503, detail="Database unavailable.")

    if not row or not row[2] or not password_hasher.verify(data.password, row[1]):

        raise HTTPException(

            status_code=401,

            detail="Invalid email or password.",

        )

    return {

        "access_token": create_access_token(row[0]),

        "token_type": "bearer",

        "expires_in": TOKEN_EXPIRE_MINUTES * 60,

    }

@app.get("/api/auth/me")

def get_my_profile(current_student=Depends(get_current_student)):

    return current_student

@app.get("/api/departments")

def get_departments():

    try:

        with get_connection() as conn:

            rows = conn.execute(

                "SELECT department_id, department_name FROM department ORDER BY department_name"

            ).fetchall()

        return [

            {"department_id": row[0], "department_name": row[1]}

            for row in rows

        ]

    except Exception:

        raise HTTPException(status_code=500, detail="Could not load departments.")

@app.get("/api/students")

def get_students():

    try:

        with get_connection() as conn:

            rows = conn.execute(

                "SELECT student_id, full_name FROM student ORDER BY full_name"

            ).fetchall()

        return [{"student_id": r[0], "full_name": r[1]} for r in rows]

    except Exception:

        raise HTTPException(status_code=500, detail="Could not load students.")

@app.get("/api/students/details")

def get_student_details():

    try:

        with get_connection() as conn:

            rows = conn.execute(

                """

                SELECT s.student_id, s.full_name,

                    COALESCE(

                        string_agg(sk.skill_name, ', ' ORDER BY sk.skill_name),

                        'No skills added'

                    ) AS skills

                FROM student s

                LEFT JOIN student_skill ss ON s.student_id = ss.student_id

                LEFT JOIN skill sk ON ss.skill_id = sk.skill_id

                GROUP BY s.student_id, s.full_name

                ORDER BY s.full_name

                """

            ).fetchall()

        return [

            {"student_id": r[0], "full_name": r[1], "skills": r[2]}

            for r in rows

        ]

    except Exception:

        raise HTTPException(status_code=500, detail="Could not load student details.")

@app.get("/api/projects")

def get_projects():

    try:

        with get_connection() as conn:

            rows = conn.execute(

                "SELECT project_id, title FROM project ORDER BY title"

            ).fetchall()

        return [{"project_id": r[0], "title": r[1]} for r in rows]

    except Exception:

        raise HTTPException(status_code=500, detail="Could not load projects.")

@app.post("/api/projects", status_code=201)

def create_project(

    data: ProjectCreateRequest,

    current_student: dict = Depends(get_current_student),

):

    if data.team_size_min > data.team_size_max:

        raise HTTPException(

            status_code=422,

            detail="Minimum team size cannot exceed maximum team size.",

        )

    if data.deadline and data.deadline < date.today():

        raise HTTPException(

            status_code=422,

            detail="The deadline cannot be in the past.",

        )

    try:

        with get_connection() as conn:

            project = conn.execute(

                """

                INSERT INTO project (

                    title,

                    description,

                    project_type,

                    domain,

                    team_size_min,

                    team_size_max,

                    deadline,

                    status,

                    created_by

                )

                VALUES (%s, %s, %s, %s, %s, %s, %s, 'Open', %s)

                RETURNING

                    project_id,

                    title,

                    description,

                    project_type,

                    domain,

                    team_size_min,

                    team_size_max,

                    deadline,

                    status,

                    created_by

                """,

                (

                    data.title.strip(),

                    data.description.strip(),

                    data.project_type.strip(),

                    data.domain.strip(),

                    data.team_size_min,

                    data.team_size_max,

                    data.deadline,

                    current_student["student_id"],

                ),

            ).fetchone()

        return {

            "message": "Project created successfully.",

            "project": {

                "project_id": project[0],

                "title": project[1],

                "description": project[2],

                "project_type": project[3],

                "domain": project[4],

                "team_size_min": project[5],

                "team_size_max": project[6],

                "deadline": (

                    project[7].isoformat() if project[7] else None

                ),

                "status": project[8],

                "created_by": project[9],

            },

        }

    except HTTPException:

        raise

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Could not create the project. Check the project schema and server log.",

        )
        

@app.get("/api/projects/details")
def get_project_details():
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT
                    project_id,
                    title,
                    description,
                    project_type,
                    domain,
                    team_size_min,
                    team_size_max,
                    deadline,
                    status,
                    created_by
                FROM project
                ORDER BY title
                """
            ).fetchall()

        return [
            {
                "project_id": r[0],
                "title": r[1],
                "description": r[2],
                "project_type": r[3],
                "domain": r[4],
                "team_size_min": r[5],
                "team_size_max": r[6],
                "deadline": r[7].isoformat() if r[7] else None,
                "status": r[8],
                "created_by": r[9],
            }
            for r in rows
        ]

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not load project details.",
        )

@app.put("/api/projects/{project_id}")
def update_project(
    project_id: int,
    data: ProjectCreateRequest,
    current_student: dict = Depends(get_current_student),
):
    if data.team_size_min > data.team_size_max:
        raise HTTPException(
            status_code=422,
            detail="Minimum team size cannot exceed maximum team size.",
        )

    if data.deadline and data.deadline < date.today():
        raise HTTPException(
            status_code=422,
            detail="The deadline cannot be in the past.",
        )

    try:
        with get_connection() as conn:
            project = conn.execute(
                """
                SELECT created_by
                FROM project
                WHERE project_id = %s
                """,
                (project_id,),
            ).fetchone()

            if not project:
                raise HTTPException(
                    status_code=404,
                    detail="Project not found.",
                )

            if project[0] != current_student["student_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="You can only edit your own projects.",
                )

            conn.execute(
                """
                UPDATE project
                SET title = %s,
                    description = %s,
                    project_type = %s,
                    domain = %s,
                    team_size_min = %s,
                    team_size_max = %s,
                    deadline = %s
                WHERE project_id = %s
                """,
                (
                    data.title.strip(),
                    data.description.strip(),
                    data.project_type.strip(),
                    data.domain.strip(),
                    data.team_size_min,
                    data.team_size_max,
                    data.deadline,
                    project_id,
                ),
            )

        return {"message": "Project updated successfully."}

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not update the project.",
        )


@app.delete("/api/projects/{project_id}")
def delete_project(
    project_id: int,
    current_student: dict = Depends(get_current_student),
):
    try:
        with get_connection() as conn:
            project = conn.execute(
                """
                SELECT created_by
                FROM project
                WHERE project_id = %s
                """,
                (project_id,),
            ).fetchone()

            if not project:
                raise HTTPException(
                    status_code=404,
                    detail="Project not found.",
                )

            if project[0] != current_student["student_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="You can only delete your own projects.",
                )

            conn.execute(
                "DELETE FROM project WHERE project_id = %s",
                (project_id,),
            )

        return {"message": "Project deleted successfully."}

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=409,
            detail=(
                "This project could not be deleted. It may have "
                "applications, teams, tasks, or other linked records."
            ),
        )

@app.get("/api/projects/{project_id}/matches")

def get_project_matches(project_id: int):

    try:

        with get_connection() as conn:

            rows = conn.execute(

                """

                SELECT s.student_id, s.full_name,

                    calculate_skill_match(p.project_id, s.student_id)

                        AS match_percentage

                FROM project p

                CROSS JOIN student s

                WHERE p.project_id = %s

                ORDER BY match_percentage DESC, s.full_name

                """,

                (project_id,),

            ).fetchall()

        if not rows:

            raise HTTPException(

                status_code=404,

                detail="Project not found or no students available.",

            )

        return [

            {

                "student_id": r[0],

                "full_name": r[1],

                "match_percentage": float(r[2]),

            }

            for r in rows

        ]

    except HTTPException:

        raise

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Could not calculate matches. Check the project and function.",

        )

@app.get("/api/profile")

def get_profile(current_student=Depends(get_current_student)):

    try:

        with get_connection() as conn:

            student = conn.execute(

                """

                SELECT full_name, email, academic_year, department_id,

                       weekly_availability_hours

                FROM student

                WHERE student_id = %s

                """,

                (current_student["student_id"],),

            ).fetchone()

            skills = conn.execute(

                """

                SELECT sk.skill_id, sk.skill_name, sk.category,

                       ss.proficiency, ss.experience_months

                FROM student_skill ss

                JOIN skill sk ON sk.skill_id = ss.skill_id

                WHERE ss.student_id = %s

                ORDER BY sk.skill_name

                """,

                (current_student["student_id"],),

            ).fetchall()

            interests = conn.execute(

                """

                SELECT i.interest_id, i.interest_name

                FROM student_interest si

                JOIN interest i ON i.interest_id = si.interest_id

                WHERE si.student_id = %s

                ORDER BY i.interest_name

                """,

                (current_student["student_id"],),

            ).fetchall()

        return {

            "full_name": student[0],

            "email": student[1],

            "academic_year": student[2],

            "department_id": student[3],

            "weekly_availability_hours": student[4],

            "skills": [

                {

                    "skill_id": r[0],

                    "skill_name": r[1],

                    "category": r[2],

                    "proficiency": r[3],

                    "experience_months": r[4],

                }

                for r in skills

            ],

            "interests": [

                {"interest_id": r[0], "interest_name": r[1]}

                for r in interests

            ],

        }

    except Exception:

        raise HTTPException(status_code=500, detail="Could not load your profile.")

@app.get("/api/skills")

def get_available_skills():

    try:

        with get_connection() as conn:

            rows = conn.execute(

                "SELECT skill_id, skill_name, category FROM skill ORDER BY skill_name"

            ).fetchall()

        return [

            {"skill_id": r[0], "skill_name": r[1], "category": r[2]}

            for r in rows

        ]

    except Exception:

        raise HTTPException(status_code=500, detail="Could not load skills.")

@app.get("/api/interests")

def get_available_interests():

    try:

        with get_connection() as conn:

            rows = conn.execute(

                "SELECT interest_id, interest_name FROM interest ORDER BY interest_name"

            ).fetchall()

        return [

            {"interest_id": r[0], "interest_name": r[1]}

            for r in rows

        ]

    except Exception:

        raise HTTPException(status_code=500, detail="Could not load interests.")

@app.put("/api/profile")

def update_profile(

    data: ProfileUpdate,

    current_student=Depends(get_current_student),

):

    try:

        with get_connection() as conn:

            conn.execute(

                """

                UPDATE student

                SET full_name = %s,

                    academic_year = %s,

                    department_id = %s,

                    weekly_availability_hours = %s

                WHERE student_id = %s

                """,

                (

                    data.full_name.strip(),

                    data.academic_year,

                    data.department_id,

                    data.weekly_availability_hours,

                    current_student["student_id"],

                ),

            )

        return {"message": "Profile updated successfully."}

    except psycopg.errors.ForeignKeyViolation:

        raise HTTPException(status_code=422, detail="Invalid department.")

    except Exception:

        raise HTTPException(status_code=500, detail="Could not update your profile.")

@app.put("/api/profile/skills")

def update_skills(

    data: SkillsUpdate,

    current_student=Depends(get_current_student),

):

    ids = [skill.skill_id for skill in data.skills]

    if len(ids) != len(set(ids)):

        raise HTTPException(status_code=422, detail="Duplicate skills are not allowed.")

    try:

        with get_connection() as conn:

            if ids:

                found = conn.execute(

                    "SELECT skill_id FROM skill WHERE skill_id = ANY(%s)",

                    (ids,),

                ).fetchall()

                if len(found) != len(ids):

                    raise HTTPException(status_code=422, detail="One or more skills are invalid.")

            student_id = current_student["student_id"]

            # Replace this student's selected skills in one transaction.

            conn.execute(

                "DELETE FROM student_skill WHERE student_id = %s",

                (student_id,),

            )

            for skill in data.skills:

                conn.execute(

                    """

                    INSERT INTO student_skill

                        (student_id, skill_id, proficiency, experience_months)

                    VALUES (%s, %s, %s, %s)

                    """,

                    (

                        student_id,

                        skill.skill_id,

                        skill.proficiency,

                        skill.experience_months,

                    ),

                )

        return {"message": "Skills saved successfully.", "count": len(ids)}

    except HTTPException:

        raise

    except Exception:

        raise HTTPException(

            status_code=422,

            detail="Could not save skills. Check the proficiency values and database constraints.",

        )

@app.put("/api/profile/interests")

def update_interests(

    data: InterestsUpdate,

    current_student=Depends(get_current_student),

):

    ids = data.interest_ids

    if any(i < 1 for i in ids) or len(ids) != len(set(ids)):

        raise HTTPException(

            status_code=422,

            detail="Interest IDs must be positive and unique.",

        )

    try:

        with get_connection() as conn:

            if ids:

                found = conn.execute(

                    "SELECT interest_id FROM interest WHERE interest_id = ANY(%s)",

                    (ids,),

                ).fetchall()

                if len(found) != len(ids):

                    raise HTTPException(

                        status_code=422,

                        detail="One or more interests are invalid.",

                    )

            student_id = current_student["student_id"]

            conn.execute(

                "DELETE FROM student_interest WHERE student_id = %s",

                (student_id,),

            )

            for interest_id in ids:

                conn.execute(

                    """

                    INSERT INTO student_interest (student_id, interest_id)

                    VALUES (%s, %s)

                    """,

                    (student_id, interest_id),

                )

        return {"message": "Interests saved successfully.", "count": len(ids)}

    except HTTPException:

        raise

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Could not save interests.",

        )

@app.get("/api/discover/projects")

def discover_projects(current_student=Depends(get_current_student)):

    try:

        with get_connection() as conn:

            rows = conn.execute(

                """

                SELECT

                    p.project_id,

                    p.title,

                    p.description,

                    p.project_type,

                    p.domain,

                    p.team_size_min,

                    p.team_size_max,

                    p.deadline,

                    p.status,

                    s.full_name AS owner_name,

                    EXISTS (

                        SELECT 1

                        FROM project_application pa

                        WHERE pa.project_id = p.project_id

                          AND pa.student_id = %s

                    ) AS already_applied

                FROM project p

                JOIN student s ON s.student_id = p.created_by

                WHERE p.status = 'Open'

                ORDER BY p.created_at DESC, p.title

                """,

                (current_student["student_id"],),

            ).fetchall()

        return [

            {

                "project_id": r[0],

                "title": r[1],

                "description": r[2],

                "project_type": r[3],

                "domain": r[4],

                "team_size_min": r[5],

                "team_size_max": r[6],

                "deadline": r[7].isoformat() if r[7] else None,

                "status": r[8],

                "owner_name": r[9],

                "already_applied": r[10],

            }

            for r in rows

        ]

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Could not load projects for discovery.",

        )

@app.post("/api/applications", status_code=201)

def apply_to_project(

    data: ProjectApplicationRequest,

    current_student=Depends(get_current_student),

):

    student_id = current_student["student_id"]

    try:

        with get_connection() as conn:

            project = conn.execute(

                """

                SELECT project_id, created_by, status

                FROM project

                WHERE project_id = %s

                """,

                (data.project_id,),

            ).fetchone()

            if not project:

                raise HTTPException(status_code=404, detail="Project not found.")

            if project[2] != "Open":

                raise HTTPException(

                    status_code=409,

                    detail="This project is not open for applications.",

                )

            if project[1] == student_id:

                raise HTTPException(

                    status_code=409,

                    detail="You cannot apply to your own project.",

                )

            existing = conn.execute(

                """

                SELECT status

                FROM project_application

                WHERE project_id = %s AND student_id = %s

                """,

                (data.project_id, student_id),

            ).fetchone()

            if existing:

                raise HTTPException(

                    status_code=409,

                    detail=f"You have already applied. Current status: {existing[0]}.",

                )

            row = conn.execute(

                """

                INSERT INTO project_application

                    (project_id, student_id, status)

                VALUES (%s, %s, 'Pending')

                RETURNING application_id, status, applied_at

                """,

                (data.project_id, student_id),

            ).fetchone()

        return {

            "message": "Application submitted successfully.",

            "application_id": row[0],

            "status": row[1],

            "applied_at": row[2].isoformat(),

        }

    except HTTPException:

        raise

    except UniqueViolation:

        raise HTTPException(

            status_code=409,

            detail="You have already applied to this project.",

        )

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Could not submit your application.",

        )

@app.get("/api/applications/mine")

def my_applications(current_student=Depends(get_current_student)):

    try:

        with get_connection() as conn:

            rows = conn.execute(

                """

                SELECT

                    pa.application_id,

                    pa.project_id,

                    p.title,

                    pa.status,

                    pa.applied_at

                FROM project_application pa

                JOIN project p ON p.project_id = pa.project_id

                WHERE pa.student_id = %s

                ORDER BY pa.applied_at DESC

                """,

                (current_student["student_id"],),

            ).fetchall()

        return [

            {

                "application_id": r[0],

                "project_id": r[1],

                "project_title": r[2],

                "status": r[3],

                "applied_at": r[4].isoformat(),

            }

            for r in rows

        ]

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Could not load your applications.",

        )

from pydantic import BaseModel

from typing import Literal

@app.get("/api/projects/{project_id}/applications")

def get_project_applications(

    project_id: int,

    current_student: dict = Depends(get_current_student),

):

    try:

        with get_connection() as conn:

            project = conn.execute(

                """

                SELECT created_by

                FROM project

                WHERE project_id = %s

                """,

                (project_id,),

            ).fetchone()

            if not project:

                raise HTTPException(

                    status_code=404,

                    detail="Project not found.",

                )

            # psycopg returns tuples by default.

            if project[0] != current_student["student_id"]:

                raise HTTPException(

                    status_code=403,

                    detail="Only the project owner can view applications.",

                )

            rows = conn.execute(

                """

                SELECT

                    pa.application_id,

                    pa.project_id,

                    pa.student_id,

                    s.full_name,

                    s.email,

                    s.academic_year,

                    pa.status,

                    pa.applied_at,

                    COALESCE(

                        ARRAY_AGG(DISTINCT sk.skill_name)

                        FILTER (WHERE sk.skill_name IS NOT NULL),

                        ARRAY[]::varchar[]

                    ) AS skills

                FROM project_application pa

                JOIN student s

                    ON s.student_id = pa.student_id

                LEFT JOIN student_skill ss

                    ON ss.student_id = s.student_id

                LEFT JOIN skill sk

                    ON sk.skill_id = ss.skill_id

                WHERE pa.project_id = %s

                GROUP BY

                    pa.application_id,

                    pa.project_id,

                    pa.student_id,

                    s.full_name,

                    s.email,

                    s.academic_year,

                    pa.status,

                    pa.applied_at

                ORDER BY pa.applied_at DESC

                """,

                (project_id,),

            ).fetchall()

        return {

            "applications": [

                {

                    "application_id": row[0],

                    "project_id": row[1],

                    "student_id": row[2],

                    "applicant_name": row[3],

                    "applicant_email": row[4],

                    "academic_year": row[5],

                    "status": row[6],

                    "applied_at": (

                        row[7].isoformat() if row[7] else None

                    ),

                    "skills": row[8] or [],

                }

                for row in rows

            ]

        }

    except HTTPException:

        raise

    except Exception:

        raise HTTPException(

            status_code=500,

            detail="Could not load project applications.",

        )

@app.put("/api/applications/{application_id}/review")

def review_project_application(

    application_id: int,

    request: ApplicationReviewRequest,

    current_student: dict = Depends(get_current_student),

):

    try:

        with get_connection() as conn:

            application = conn.execute(

                """

                SELECT

                    pa.status,

                    p.created_by,

                    pa.project_id,

                    pa.student_id,

                    p.title

                FROM project_application pa

                JOIN project p

                    ON p.project_id = pa.project_id

                WHERE pa.application_id = %s

                FOR UPDATE OF pa

                """,

                (application_id,),

            ).fetchone()

            if not application:

                raise HTTPException(

                    status_code=404,

                    detail="Application not found.",

                )

            current_status = application[0]

            project_owner_id = application[1]

            project_id = application[2]

            applicant_id = application[3]

            project_title = application[4]

            if project_owner_id != current_student["student_id"]:

                raise HTTPException(

                    status_code=403,

                    detail="Only the project owner can review this application.",

                )

            if current_status != "Pending":

                raise HTTPException(

                    status_code=409,

                    detail="Only pending applications can be reviewed.",

                )

            if request.status == "Accepted":

                # Find an existing team for this project.

                team = conn.execute(

                    """

                    SELECT team_id, leader_id

                    FROM team

                    WHERE project_id = %s

                    ORDER BY team_id

                    LIMIT 1

                    FOR UPDATE

                    """,

                    (project_id,),

                ).fetchone()

                if not team:

                    team = conn.execute(

                        """

                        INSERT INTO team

                            (project_id, team_name, leader_id, status)

                        VALUES (%s, %s, %s, 'Forming')

                        RETURNING team_id, leader_id

                        """,

                        (

                            project_id,

                            f"{project_title} Team",

                            project_owner_id,

                        ),

                    ).fetchone()

                team_id = team[0]

                leader_id = team[1]

                # Ensure the project leader is also a team member.

                conn.execute(

                    """

                    INSERT INTO team_member

                        (team_id, student_id, member_role, status)

                    VALUES (%s, %s, 'Leader', 'Active')

                    ON CONFLICT (team_id, student_id) DO NOTHING

                    """,

                    (team_id, leader_id),

                )

                # The existing database trigger should enforce team capacity.

                conn.execute(

                    """

                    INSERT INTO team_member

                        (team_id, student_id, member_role, status)

                    VALUES (%s, %s, 'Member', 'Active')

                    """,

                    (team_id, applicant_id),

                )

            updated = conn.execute(

                """

                UPDATE project_application

                SET status = %s

                WHERE application_id = %s

                  AND status = 'Pending'

                RETURNING application_id, project_id, student_id,

                          status, applied_at

                """,

                (request.status, application_id),

            ).fetchone()

            if not updated:

                raise HTTPException(

                    status_code=409,

                    detail="The application has already been reviewed.",

                )

        return {

            "message": f"Application {request.status.lower()} successfully.",

            "application": {

                "application_id": updated[0],

                "project_id": updated[1],

                "student_id": updated[2],

                "status": updated[3],

                "applied_at": (

                    updated[4].isoformat() if updated[4] else None

                ),

            },

        }

    except HTTPException:

        raise

    except Exception as exc:

        # A failed team insert or capacity check must not leave

        # an application marked Accepted without team membership.

        if "capacity" in str(exc).lower():

            raise HTTPException(

                status_code=409,

                detail="The team is full. The application was not accepted.",

            )

        raise HTTPException(
            status_code=500,
            detail="Could not review the application. Check the server log.",
        )
