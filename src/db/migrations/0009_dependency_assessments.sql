-- Existing boolean/fingerprint assessments remain historical evidence. No missing
-- report is converted into an assertion of independence.
CREATE TABLE dependency_assessments (
 id TEXT PRIMARY KEY,
 targetId TEXT NOT NULL REFERENCES oversight_nodes(id),
 targetKind TEXT NOT NULL CHECK(targetKind IN ('stream','change')),
 scopeStreamId TEXT REFERENCES streams(id),
 scopeFingerprint TEXT NOT NULL,
 planFingerprint TEXT NOT NULL,
 reviewedIds TEXT NOT NULL,
 coverage TEXT NOT NULL CHECK(coverage IN ('complete','partial')),
 start TEXT NOT NULL,
 deliver TEXT NOT NULL,
 reportedBy TEXT NOT NULL REFERENCES actors(id),
 reportedAt INTEGER NOT NULL
);
CREATE INDEX dependency_assessment_target ON dependency_assessments(targetId);

CREATE TABLE implementation_claims (
 claimId TEXT PRIMARY KEY REFERENCES collaboration_claims(id),
 assessmentId TEXT NOT NULL REFERENCES dependency_assessments(id)
);
