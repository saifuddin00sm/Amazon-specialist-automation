-- New campaign plans: one Proposal with the campaigns, ad groups, targets, bids and budgets the
-- campaign strategist would create from a brief in the New campaign wizard.
-- No new tables: the plan is a row in proposals (targeting its seller account) and its run a row in
-- agent_runs, so the existing row-level security policies on both apply as they are. The strategist
-- runs on one account at a time through agent_runs_one_running_idx on (subject_type, subject_id).

alter type public.proposal_type add value 'new_campaign';
alter type public.agent_name add value 'campaign_strategist';
