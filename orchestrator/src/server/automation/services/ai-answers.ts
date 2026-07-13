/**
 * AI-powered answers for application screening questions.
 *
 * Uses the existing LLM infrastructure (same as scoring/tailoring).
 */

import { logger } from "@infra/logger";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import {
  createConfiguredLlmService,
  resolveLlmModel,
} from "@server/services/modelSelection";
import { getProfile } from "@server/services/profile";

interface QuestionContext {
  jobTitle: string;
  employer: string;
  jobDescription: string | null;
  questions: string[];
}

const ANSWERS_SCHEMA: JsonSchemaDefinition = {
  name: "application_answers",
  schema: {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
          required: ["question", "answer"],
          additionalProperties: false,
        },
      },
    },
    required: ["answers"],
    additionalProperties: false,
  },
};

const COVER_LETTER_SCHEMA: JsonSchemaDefinition = {
  name: "cover_letter",
  schema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

export async function generateAiAnswers(
  ctx: QuestionContext,
): Promise<Map<string, string>> {
  if (ctx.questions.length === 0) {
    return new Map();
  }

  let profileText = "";
  try {
    const profile = await getProfile();
    profileText = JSON.stringify(profile, null, 2);
  } catch {
    profileText = "No profile available";
  }

  const llm = await createConfiguredLlmService("scoring");
  const model = await resolveLlmModel("scoring");

  const systemPrompt =
    "You are an expert job application assistant. Answer screening questions " +
    "concisely and professionally based on the candidate profile. " +
    "Be truthful — do not invent qualifications the candidate does not have.";

  const userPrompt =
    `Job: ${ctx.jobTitle} at ${ctx.employer}\n` +
    (ctx.jobDescription ? `\nJob Description:\n${ctx.jobDescription}\n` : "") +
    `\nCandidate Profile:\n${profileText}\n\n` +
    `Answer each of the following application questions:\n` +
    ctx.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  const response = await llm.callJson<{
    answers: Array<{ question: string; answer: string }>;
  }>({
    model,
    jsonSchema: ANSWERS_SCHEMA,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxRetries: 1,
  });

  if (!response.success) {
    logger.warn("AI answers generation failed", { error: response.error });
    return new Map(ctx.questions.map((q) => [q, ""]));
  }

  const answers = new Map<string, string>();
  for (const entry of response.data.answers ?? []) {
    answers.set(entry.question, entry.answer);
  }
  for (const q of ctx.questions) {
    if (!answers.has(q)) answers.set(q, "");
  }
  return answers;
}

export async function generateCoverLetter(params: {
  jobTitle: string;
  employer: string;
  jobDescription: string | null;
}): Promise<string> {
  let profileText = "";
  try {
    const profile = await getProfile();
    profileText = JSON.stringify(profile, null, 2);
  } catch {
    profileText = "No profile available";
  }

  const llm = await createConfiguredLlmService("tailoring");
  const model = await resolveLlmModel("tailoring");

  const systemPrompt =
    "You are an expert cover letter writer. Write concise, tailored cover letters " +
    "in 3 paragraphs under 280 words. Address 'Dear Hiring Team,' and sign off " +
    "with 'Best regards,' followed by the candidate's actual name from the profile.";

  const userPrompt =
    `Job: ${params.jobTitle} at ${params.employer}\n` +
    (params.jobDescription
      ? `\nJob Description:\n${params.jobDescription}\n`
      : "") +
    `\nCandidate Profile:\n${profileText}\n\nWrite the cover letter now:`;

  const response = await llm.callJson<{ text: string }>({
    model,
    jsonSchema: COVER_LETTER_SCHEMA,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  if (!response.success) {
    logger.warn("Cover letter generation failed", { error: response.error });
    return "";
  }
  return response.data.text ?? "";
}
