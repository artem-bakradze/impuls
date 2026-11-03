/** The public example returns to the owner's existing business through the usual entry route. */
export const homePath = (business: { launchedOn: string | null } | null): string => business?.launchedOn ? "/summary" : "/wizard";
