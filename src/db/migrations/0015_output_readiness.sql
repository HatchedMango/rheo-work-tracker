-- Provider observations are evidence only; no graph or progress transitions.
ALTER TABLE output_observations ADD COLUMN mergeStatus TEXT;
ALTER TABLE output_observations ADD COLUMN hasConflicts INTEGER;
ALTER TABLE output_observations ADD COLUMN discussionsResolved INTEGER;
ALTER TABLE output_observations ADD COLUMN draft INTEGER;
ALTER TABLE output_observations ADD COLUMN failureCode TEXT;
ALTER TABLE output_observations ADD COLUMN httpStatus INTEGER;
