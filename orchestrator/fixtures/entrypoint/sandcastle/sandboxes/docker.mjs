// Test-only stand-in (#74): Sandcastle's docker() provider must not be used by a recovery attempt.
export const docker = () => { throw new Error("Sandcastle's docker() must not be used by a recovery attempt"); };
