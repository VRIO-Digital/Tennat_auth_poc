# Backend (FastAPI)

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:

```
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@127.0.0.1:5432/app
```

Create the schema, then start the API:

```
alembic upgrade head
uvicorn main:app --reload --port 8000
```

Docs: http://localhost:8000/docs

## Database migrations (Alembic)

```
alembic revision --autogenerate -m "describe the change"   # after editing models in main.py
alembic upgrade head                                         # apply
alembic downgrade -1                                         # roll back one step
alembic current                                              # show current revision
```

Existing database that already has the tables (created before Alembic was added):
`alembic stamp head`
