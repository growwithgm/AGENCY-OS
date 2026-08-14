/**
 * Client-facing wording. English only, by decision — one language means a
 * missing translation can never take a page down, and every string lives
 * here rather than scattered through the components.
 */

export type Locale = 'en';

export const COPY = {
  subtitle: 'Where your work with us stands today.',
  overToYou: 'Over to you',
  askedFor: 'Asked for',
  askUs: 'Ask us for something',
  inProgress: 'In progress',
  upcoming: 'Approved and coming up',
  completed: 'Completed',
  nothingInProgress: 'Nothing is being worked on right now.',
  nothingUpcoming: 'Nothing is queued up at the moment.',
  nothingCompleted: 'Nothing has been completed yet.',
  whatYouAsked: 'What you have asked for',
  noRequests: 'You have not asked for anything yet.',
  latestUpdate: 'Your latest update',
  noUpdate: 'Your first update will appear here.',
  newLabel: 'New',
  by: 'By',
  today: 'Today',
  yesterday: 'Yesterday',
  account: 'Your account',
  signOut: 'Sign out',
  daysAgo: (n: number) => `${n} days ago`,
  requestState: (state: string) => ({
    clarifying: 'We have a question',
    pending_approval: 'With us',
    approved: 'Approved',
    rejected: 'Not going ahead',
    expired: 'Closed',
  } as Record<string, string>)[state] ?? 'With us',
  shell: {
    portalTitle: 'Client portal',
    workspace: 'Client workspace',
    navOverview: 'Overview',
    navTasks: 'Active work',
    navAsk: 'Ask for something',
    navHistory: 'History',
    help: 'Need something? Ask below — every request reaches us straight away.',
    statActive: 'In progress',
    statWaiting: 'Waiting on you',
    statOpenRequests: 'Open requests',
    statCompleted: 'Completed',
    activeTitle: 'Active work',
    activeSub: 'What is moving right now, and what is queued next.',
    askTitle: 'Ask us for something',
    askSub: 'Tell us what you need in simple words.',
    historyTitle: 'Completed work',
    historySub: 'What has been finished for you.',
    colTask: 'Task',
    colCompleted: 'Completed',
    colStatus: 'Status',
    done: 'Done',
    statusInProgress: 'In progress',
    statusUpcoming: 'Queued',
    statusWaiting: 'Waiting on you',
    noneActive: 'Nothing is in progress or queued right now.',
    noneCompleted: 'Nothing has been completed yet.',
  },
  request: {
    close: 'Close',
    stepOf: (i: number, n: number) => `${i} of ${n}`,
    titleLabel: 'Task title',
    titlePlaceholder: 'e.g. Create new Meta campaign',
    prompt: 'What do you need?',
    detailPlaceholder: 'Explain the task, links, requirements or anything we should know…',
    detailHelper: 'You do not need to write a formal brief.',
    urgencyLabel: 'How urgent is this for you?',
    urgencyNormal: 'Normal',
    urgencyHigh: 'High',
    urgencyUrgent: 'Urgent',
    neededByLabel: 'Needed by',
    neededByHelper: 'The date you are hoping for — we will confirm what is realistic.',
    serviceLabel: 'Service area',
    servicePlaceholder: 'Select service',
    referenceLabel: 'Reference link',
    referencePlaceholder: 'Paste a Drive, product or page link',
    submit: 'Submit request',
    answerLabel: 'Your answer',
    send: 'Send',
    sending: 'Sending…',
    received: 'Received',
    receivedBody:
      'Received — this will be reviewed. Nothing is scheduled until the agency confirms what '
      + 'they can take on and when.',
    backToPage: 'Back to your page',
    notCommitment:
      'This is a request, not a commitment. The agency will confirm what they can take on and when.',
    weHaveAQuestion: 'We have a question',
    questionHelper:
      'Your request is already with us — answering just adds the detail. You can also answer '
      + 'later from your page, or leave it.',
  },
} as const;

/** Kept for call sites that pass a locale; there is only English now. */
export function t(_locale?: string) {
  return COPY;
}
