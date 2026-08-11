// Strict JSON schemas for response_format (spec §8.2 #4).
// Schema guarantees the shape — prompts never say "return only JSON".

export const parseTaskSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'description', 'client_hint', 'project_hint',
          'est_minutes', 'priority', 'due_hint', 'depends_on_hint', 'confidence',
        ],
        properties: {
          title:           { type: 'string' },
          description:     { type: 'string' },
          client_hint:     { type: ['string', 'null'] },
          project_hint:    { type: ['string', 'null'] },
          est_minutes:     { type: 'integer' },
          // placeholder only — real priority is always chosen by the operator (§7.7)
          priority:        { type: 'integer', minimum: 1, maximum: 5 },
          due_hint:        { type: ['string', 'null'] },
          depends_on_hint: { type: ['string', 'null'] },
          confidence:      { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

export const clarifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field', 'question', 'options'],
  properties: {
    field:    { type: 'string' },
    question: { type: 'string' },
    options:  { type: ['array', 'null'], items: { type: 'string' } },
  },
} as const;

export type ParsedTask = {
  title: string;
  description: string;
  client_hint: string | null;
  project_hint: string | null;
  est_minutes: number;
  priority: number;
  due_hint: string | null;
  depends_on_hint: string | null;
  confidence: number;
};

export type ParseResult = { tasks: ParsedTask[] };

export type ClarifyQuestion = {
  field: string;
  question: string;
  options: string[] | null;
};
