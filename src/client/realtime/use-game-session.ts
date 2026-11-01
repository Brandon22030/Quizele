import { useCallback, useEffect, useReducer, useRef } from "react";
import { createQuestionClock, type QuestionClock } from "../../shared/clock";
import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import { GameSocket } from "./game-socket";
import { initialSessionState, sessionReducer } from "./session-state";

export interface UseGameSessionOptions {
  code: string;
  getToken: () => string | Promise<string>;
  baseUrl?: string;
}

function clockFor(message: ServerMessage): QuestionClock | null {
  // Créée à la réception : la dérive est mesurée à cet instant, avec le serverNow du message.
  if (message.type === "question") return createQuestionClock(message);
  if (message.type === "snapshot" && message.question) {
    const { startedAt, durationMs } = message.question;
    return createQuestionClock({ startedAt, durationMs, serverNow: message.serverNow });
  }
  return null;
}

export function useGameSession({ code, getToken, baseUrl }: UseGameSessionOptions) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const socketRef = useRef<GameSocket | null>(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    const socket = new GameSocket({
      code,
      baseUrl,
      getToken: () => getTokenRef.current(),
      onStatus: (status) => dispatch({ type: "connection", status }),
      onMessage: (message) => dispatch({ type: "message", message, clock: clockFor(message) }),
    });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [code, baseUrl]);

  const send = useCallback((message: ClientMessage) => socketRef.current?.send(message), []);
  const answer = useCallback(
    (questionId: string, optionIds: string[]) => send({ type: "answer", questionId, optionIds }),
    [send],
  );

  return { state, send, answer };
}
