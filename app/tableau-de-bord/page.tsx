import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/ui/account-menu";
import { QuizzesLoader } from "@/app/tableau-de-bord/quizzes-loader";
import { QuizListSkeleton } from "@/app/tableau-de-bord/quiz-list-skeleton";
import { createSampleQuiz } from "@/app/tableau-de-bord/actions";

export default function TableauDeBordPage() {
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between border-b border-adire px-4 py-3">
        <h1 className="font-display text-xl text-foreground">Tes quiz</h1>
        <div className="flex items-center gap-2">
          <form action={createSampleQuiz}>
            <Button variant="primary" size="md" type="submit">
              Créer un quiz
            </Button>
          </form>
          <AccountMenu />
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Suspense fallback={<QuizListSkeleton />}>
          <QuizzesLoader />
        </Suspense>
      </main>
    </div>
  );
}
