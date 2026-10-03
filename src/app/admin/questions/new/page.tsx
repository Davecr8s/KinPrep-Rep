import type { Metadata } from "next";
import { Notice } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listTopics } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";
import { saveQuestionAction } from "../actions";
import { QuestionEditor } from "../question-editor";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage({ searchParams }: PageProps<"/admin/questions/new">) {
  await requireStaff("/admin/questions/new");
  const query = await searchParams;
  const topics = await listTopics(appSql());
  if (topics.length === 0) {
    return <Notice tone="warn">Add a topic in the syllabus first.</Notice>;
  }
  const topic = typeof query.topic === "string" ? query.topic : undefined;
  return (
    <QuestionEditor
      topics={topics}
      initial={
        topic && topics.some((t) => t.id === topic)
          ? {
              topicId: topic,
              stem: "",
              options: [],
              answerIndex: 0,
              explanationEn: "",
              explanationPcm: "",
              classes: ["SS1", "SS2", "SS3", "UTME"],
              syllabusRef: "",
              originalConfirmed: false,
              source: "human",
              status: "draft",
            }
          : null
      }
      action={saveQuestionAction.bind(null, null)}
    />
  );
}
