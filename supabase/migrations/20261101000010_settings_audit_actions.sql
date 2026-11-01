-- Audit actions for team changes and the agents kill switch. On their own because Postgres only
-- lets a new enum value be used once the transaction that added it commits.

alter type public.audit_action add value 'member.updated';
alter type public.audit_action add value 'member.removed';
alter type public.audit_action add value 'agents.paused';
alter type public.audit_action add value 'agents.resumed';
