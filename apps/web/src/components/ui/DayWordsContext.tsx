"use client";

import { createContext, useContext } from "react";
import { calendarWords } from "@/lib/day-words";
import type { DayWords } from "@/lib/day-words";

/**
 * How «Реклама» and its sheets name days: the calendar in Direct, day numbers in a simulation (simulation-mode spec «Дни
 * симуляции вместо дат»). `SummaryView` provides it from the business's mode; outside it the calendar is the default.
 */
export const DayWordsContext = createContext<DayWords>(calendarWords);

export const useDayWords = (): DayWords => useContext(DayWordsContext);
