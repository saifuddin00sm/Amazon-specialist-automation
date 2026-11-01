-- Campaign plans: one Proposal that bundles bid, keyword and negative keyword changes to a campaign,
-- drafted by the campaign optimizer. Postgres only lets a new enum value be used once the
-- transaction that added it commits, so the index and function that use them are the next migration.

alter type public.proposal_type add value 'campaign_plan';
alter type public.agent_name add value 'campaign_optimizer';
