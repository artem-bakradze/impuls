export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Virtual clock driven by SimulationDriver and tests. */
export class ManualClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(at: Date): void {
    this.current = new Date(at.getTime());
  }
  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }
}
