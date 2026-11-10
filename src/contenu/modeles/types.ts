import type { GAME_MODES, QuestionData } from "../../shared/quiz-schema";

export interface Modele {
  id: string;
  title: string;
  description: string;
  category: string | null;
  mode: (typeof GAME_MODES)[number];
  questions: QuestionData[];
}
