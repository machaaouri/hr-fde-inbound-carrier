export function isWebkeyNotFoundBody(body: unknown): boolean {
  if (body === null || typeof body !== "object") {
    return false;
  }
  const content = (body as Record<string, unknown>).content;
  return content === "Webkey not found";
}

export function readCarrierFromDocketBody(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const content = (body as Record<string, unknown>).content;

  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (first !== null && typeof first === "object") {
      const row = first as Record<string, unknown>;
      if (row.carrier && typeof row.carrier === "object") {
        return row.carrier as Record<string, unknown>;
      }
      return row;
    }
    return null;
  }

  if (content !== null && typeof content === "object") {
    const c = content as Record<string, unknown>;
    const carrier = c.carrier;
    if (carrier !== null && typeof carrier === "object") {
      return carrier as Record<string, unknown>;
    }
  }

  return null;
}

export function readCarrierAuthorityRows(body: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  if (body === null || typeof body !== "object") {
    return rows;
  }
  const content = (body as Record<string, unknown>).content;

  if (Array.isArray(content)) {
    for (const item of content) {
      if (item === null || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const authority = row.carrierAuthority;
      if (authority !== null && typeof authority === "object") {
        rows.push(authority as Record<string, unknown>);
      }
    }
    return rows;
  }

  if (content !== null && typeof content === "object") {
    const c = content as Record<string, unknown>;
    const authority = c.carrierAuthority;
    if (Array.isArray(authority)) {
      for (const row of authority) {
        if (row && typeof row === "object") {
          rows.push(row as Record<string, unknown>);
        }
      }
    } else if (authority !== null && typeof authority === "object") {
      rows.push(authority as Record<string, unknown>);
    }
    const authorities = c.authorities;
    if (Array.isArray(authorities)) {
      for (const row of authorities) {
        if (row && typeof row === "object") {
          rows.push(row as Record<string, unknown>);
        }
      }
    }
  }

  return rows;
}

/** Legacy helper: uppercase status tokens from authority payloads. */
export function readAuthorityStatuses(body: unknown): string[] {
  const statuses: string[] = [];
  const pushStatus = (value: unknown): void => {
    if (typeof value === "string" && value.trim() !== "") {
      statuses.push(value.trim().toUpperCase());
    }
  };

  for (const row of readCarrierAuthorityRows(body)) {
    pushStatus(row.authorityStatus);
    pushStatus(row.status);
    pushStatus(row.commonAuthorityStatus);
    pushStatus(row.contractAuthorityStatus);
    pushStatus(row.brokerAuthorityStatus);
  }

  return statuses;
}
