"""login events

Revision ID: 0002
Revises: 0001
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('login_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('workspace_id', sa.Integer(), nullable=True),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('method', sa.String(length=60), nullable=False),
    sa.Column('success', sa.Boolean(), nullable=False),
    sa.Column('reason', sa.String(length=255), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_login_events_user_id'), 'login_events', ['user_id'], unique=False)
    op.create_index(op.f('ix_login_events_workspace_id'), 'login_events', ['workspace_id'], unique=False)
    op.create_index(op.f('ix_login_events_created_at'), 'login_events', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_login_events_created_at'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_workspace_id'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_user_id'), table_name='login_events')
    op.drop_table('login_events')
