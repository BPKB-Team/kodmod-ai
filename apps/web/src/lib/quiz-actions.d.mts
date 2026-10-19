import type { QuizActionRequest, QuizInteractionView } from "./quiz-types";
export function parseQuizAction(input: unknown): QuizActionRequest;
export function prepareQuizAction(pending: Readonly<QuizActionRequest> | null, input: Omit<QuizActionRequest,"action_id">, createId?: () => string): Readonly<QuizActionRequest>;
export function quizUiState(view: Partial<QuizInteractionView>): {phase:"active"|"review"|"complete"; canAnswer:boolean; canHint:boolean; canAdvance:boolean};
export function validInteraction(input: unknown): boolean;
export function readQuizInteraction(response: Response): Promise<QuizInteractionView>;
