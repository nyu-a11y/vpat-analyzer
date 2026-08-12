export const DOMAIN_VERSIONS = Object.freeze({
  schemaVersion: "1.0.0",
  catalogVersion: "1.0.0",
  rubricVersion: "1.0.0",
  scoringVersion: "1.0.0",
  conformancePromptVersion: "1.0.0",
  qualityPromptVersion: "1.0.0",
  conformanceSchemaVersion: "1.0.0",
  qualitySchemaVersion: "1.0.0",
  ingestionSchemaVersion: "1.0.0",
  exportSchemaVersion: "1.0.0",
  templateVersion: "1.0.0",
});

export function exportProvenance(overrides = {}) {
  const versions = { ...DOMAIN_VERSIONS, ...overrides };
  return Object.freeze({
    catalogVersion: versions.catalogVersion,
    rubricVersion: versions.rubricVersion,
    scoringVersion: versions.scoringVersion,
    conformancePromptVersion: versions.conformancePromptVersion,
    qualityPromptVersion: versions.qualityPromptVersion,
    conformanceSchemaVersion: versions.conformanceSchemaVersion,
    qualitySchemaVersion: versions.qualitySchemaVersion,
    ingestionSchemaVersion: versions.ingestionSchemaVersion,
    exportSchemaVersion: versions.exportSchemaVersion,
    templateVersion: versions.templateVersion,
  });
}
