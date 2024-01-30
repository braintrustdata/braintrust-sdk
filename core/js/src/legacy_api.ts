export function patchLegacyRecord(r: Record<string, any>): Record<string, any> {
  if (!("dataset_id" in r)) {
    return r;
  }
  const record = { ...r };
  if (!("expected" in record)) {
    record.expected = record.output;
  }
  delete record.output;
  return record;
}

export function patchLegacyRecordString(s: string): string {
  return JSON.stringify(patchLegacyRecord(JSON.parse(s)));
}


export function makeLegacyRecord(r: Record<string, any>): Record<string, any> {
  if (!("dataset_id" in r)) {
    return r;
  }
  const record = { ...r };
  if (!("output" in record)) {
    record.output = record.expected;
  }
  delete record.expected;
  return record;
}

export function makeLegacyRecordString(s: string): string {
  return JSON.stringify(makeLegacyRecord(JSON.parse(s)));
}
