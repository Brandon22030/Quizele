import { QuizCard, type QuizSummary } from "@/app/tableau-de-bord/quiz-card";
import { EmptyDashboard } from "@/app/tableau-de-bord/empty-dashboard";

export function QuizList({ quizzes }: { quizzes: QuizSummary[] }) {
  if (quizzes.length === 0) {
    return <EmptyDashboard />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {quizzes.map((quiz) => (
        <QuizCard key={quiz.id} quiz={quiz} />
      ))}
    </div>
  );
}
