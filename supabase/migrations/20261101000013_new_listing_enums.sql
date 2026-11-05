-- New listings: one Proposal with every attribute of a listing for a product that isn't on Amazon
-- yet, drafted by the listing creator from a brief in the New listing wizard.
-- No new tables: the draft is a row in proposals (targeting its seller account) and its run a row in
-- agent_runs, so the existing row-level security policies on both apply as they are. Listing creator
-- runs have no subject, so agent_runs_one_running_idx doesn't hold one back while another drafts, or
-- while the campaign strategist plans for the same account. Product type schemas come from Amazon
-- and aren't stored.

alter type public.proposal_type add value 'new_listing';
alter type public.agent_name add value 'listing_creator';
