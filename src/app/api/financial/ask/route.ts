import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { financialDataUnavailableResponse } from "@/lib/financial/financialDataUnavailableResponse";
import { parseLedgerQuery } from "@/domains/ledger/brain/parseLedgerQuery.js";
import { answerLedgerQuery } from "@/domains/ledger/brain/answerLedgerQuery.js";

const ASK_HINT =
  "I can answer questions like 'what did I spend on dining last month?' or 'revenue from rent in Q2'.";

export async function POST(request: Request) {
  const authenticatedApplication =
    await createAuthenticatedFinancialApplication();

  if (authenticatedApplication.response) {
    return authenticatedApplication.response;
  }

  const { reportingApplication } =
    await authenticatedApplication.getFinancialApplicationSuite();

  if (!reportingApplication) {
    return financialDataUnavailableResponse();
  }

  let body = null;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const question = body?.question;

  if (typeof question !== "string" || question.trim() === "") {
    return Response.json(
      {
        success: false,
        error: "A non-empty question string is required.",
      },
      { status: 400 },
    );
  }

  const parsed = parseLedgerQuery(question);

  if ("unparseable" in parsed) {
    return Response.json({
      success: true,
      data: {
        unparseable: true,
        hint: ASK_HINT,
      },
    });
  }

  const answer = answerLedgerQuery({
    engine: reportingApplication.engine,
    parsed,
    question,
  });

  return Response.json({
    success: true,
    data: {
      answer,
    },
  });
}
