/**
 * Education Agent Types (Phase 4)
 * Core domain types for the Education Agent and study platform.
 */

export type Language = "en" | "bn" | "mixed";

export type Difficulty = "easy" | "medium" | "hard" | "university";

export type QuestionType =
  | "mcq"
  | "true_false"
  | "fill_blank"
  | "short"
  | "long"
  | "viva"
  | "matching"
  | "case_based";

export type EducationMode =
  | "learn"
  | "exam"
  | "practice"
  | "test"
  | "viva"
  | "flashcard"
  | "study_plan";

export type ExplanationLevel = "beginner" | "intermediate" | "advanced";

export type ExamMarks = 1 | 2 | 3 | 5 | 10 | 15;

export type QuizStatus = "in_progress" | "completed" | "abandoned";

export type StudyPlanStatus = "active" | "completed" | "paused";

export type StudyGoalType = "daily" | "weekly" | "exam" | "topic";

export type FlashcardRating = 1 | 2 | 3 | 4; // 1=again, 2=hard, 3=good, 4=easy

export interface SubjectData {
  id: string;
  userId: string;
  name: string;
  description?: string;
  color?: string;
  topicCount: number;
  questionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TopicData {
  id: string;
  subjectId: string;
  name: string;
  description?: string;
  parentId?: string;
  order: number;
  subtopicCount: number;
  questionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionData {
  id: string;
  userId: string;
  subjectId?: string;
  topicId?: string;
  question: string;
  type: QuestionType;
  difficulty: Difficulty;
  options?: MCQOption[]; // For MCQ
  correctAnswer?: string;
  explanation?: string;
  source?: string;
  sourceDocId?: string;
  sourcePage?: number;
  tags?: string[];
  language: Language;
  createdAt: Date;
  updatedAt: Date;
}

export interface MCQOption {
  label: string;
  text: string;
}

export interface MCQQuestion {
  question: string;
  options: MCQOption[];
  correctAnswer: string;
  explanation: string;
  difficulty: Difficulty;
  topic?: string;
  sourceDocId?: string;
  sourcePage?: number;
}

export interface QuizSessionData {
  id: string;
  userId: string;
  subjectId?: string;
  topicId?: string;
  name: string;
  totalQuestions: number;
  currentIndex: number;
  score: number;
  status: QuizStatus;
  settings?: QuizSettings;
  startedAt: Date;
  completedAt?: Date;
}

export interface QuizSettings {
  timeLimit?: number; // seconds
  difficulty?: Difficulty;
  questionTypes?: QuestionType[];
  language?: Language;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
}

export interface QuizAnswerData {
  id: string;
  quizSessionId: string;
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  timeSpent?: number;
  createdAt: Date;
}

export interface FlashcardData {
  id: string;
  userId: string;
  subjectId?: string;
  topicId?: string;
  front: string;
  back: string;
  difficulty: Difficulty;
  tags?: string[];
  language: Language;
  createdAt: Date;
  updatedAt: Date;
}

export interface FlashcardReviewData {
  id: string;
  flashcardId: string;
  userId: string;
  rating: FlashcardRating;
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReviewAt: Date;
  reviewedAt: Date;
}

export interface StudyProgressData {
  id: string;
  userId: string;
  subjectId?: string;
  topicId?: string;
  questionsAttempted: number;
  questionsCorrect: number;
  accuracy: number;
  studyMinutes: number;
  flashcardsReviewed: number;
  masteryEstimate: number;
  lastStudiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudyPlanData {
  id: string;
  userId: string;
  subjectId: string;
  name: string;
  examDate?: Date;
  totalHours?: number;
  dailyHours?: number;
  startDate: Date;
  endDate?: Date;
  status: StudyPlanStatus;
  planData: StudyPlanDaily[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StudyPlanDaily {
  date: Date;
  topics: StudyPlanTopic[];
  totalMinutes: number;
}

export interface StudyPlanTopic {
  topicId: string;
  topicName: string;
  durationMinutes: number;
  activities: StudyActivity[];
}

export type StudyActivity =
  | { type: "read"; topicId: string; durationMinutes: number }
  | { type: "mcq"; count: number; durationMinutes: number }
  | { type: "viva"; count: number; durationMinutes: number }
  | { type: "flashcard"; count: number; durationMinutes: number }
  | { type: "summary"; topicId: string; durationMinutes: number }
  | { type: "practice"; topicId: string; durationMinutes: number };

export interface StudyGoalData {
  id: string;
  userId: string;
  subjectId?: string;
  type: StudyGoalType;
  target: StudyGoalTarget;
  current: StudyGoalCurrent;
  periodStart: Date;
  periodEnd?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudyGoalTarget {
  minutes?: number;
  questions?: number;
  flashcards?: number;
  topics?: string[];
}

export interface StudyGoalCurrent {
  minutes: number;
  questions: number;
  flashcards: number;
  topicsCompleted: string[];
}

export interface EducationExplainRequest {
  topic: string;
  level?: ExplanationLevel;
  language?: Language;
  subjectId?: string;
  topicId?: string;
  documentIds?: string[];
  mode?: "simple" | "deep" | "example" | "exam" | "notes";
}

export interface EducationExplainResponse {
  topic: string;
  level: ExplanationLevel;
  language: Language;
  explanation: string;
  keyPoints: string[];
  examples: string[];
  examAnswer?: string;
  citations: EducationCitation[];
  followUpQuestions: string[];
}

export interface EducationCitation {
  documentId: string;
  documentTitle: string;
  pageNumber?: number;
  excerpt: string;
}

export interface EducationQuestionGenerateRequest {
  topic: string;
  count: number;
  type: QuestionType;
  difficulty: Difficulty;
  language?: Language;
  subjectId?: string;
  topicId?: string;
  documentIds?: string[];
  examMarks?: ExamMarks;
}

export interface EducationQuestionGenerateResponse {
  questions: QuestionData[];
}

export interface EducationQuizStartRequest {
  subjectId?: string;
  topicId?: string;
  name: string;
  questionCount: number;
  settings?: QuizSettings;
}

export interface EducationQuizStartResponse {
  sessionId: string;
  firstQuestion: QuizQuestionData;
}

export interface QuizQuestionData {
  questionId: string;
  index: number;
  total: number;
  question: string;
  type: QuestionType;
  options?: MCQOption[];
  difficulty: Difficulty;
  timeRemaining?: number;
}

export interface EducationQuizAnswerRequest {
  sessionId: string;
  questionId: string;
  answer: string;
  timeSpent?: number;
}

export interface EducationQuizAnswerResponse {
  isCorrect: boolean;
  correctAnswer?: string;
  explanation?: string;
  score: number;
  nextQuestion?: QuizQuestionData;
  completed: boolean;
  finalScore?: number;
}

export interface EducationEvaluateRequest {
  question: string;
  userAnswer: string;
  expectedAnswer?: string;
  markingScheme?: string;
  totalMarks?: number;
  language?: Language;
}

export interface EducationEvaluateResponse {
  score: number;
  maxScore: number;
  feedback: EducationFeedback;
  idealAnswer: string;
  keyPoints: string[];
}

export interface EducationFeedback {
  strengths: string[];
  weaknesses: string[];
  missingPoints: string[];
  improvements: string[];
}

export interface EducationVivaRequest {
  subjectId?: string;
  topicId?: string;
  difficulty?: Difficulty;
  questionCount?: number;
  language?: Language;
  documentIds?: string[];
}

export interface EducationVivaResponse {
  sessionId: string;
  question: string;
  questionNumber: number;
  totalQuestions: number;
}

export interface EducationVivaAnswerRequest {
  sessionId: string;
  answer: string;
}

export interface EducationVivaAnswerResponse {
  feedback: EducationFeedback;
  nextQuestion?: string;
  completed: boolean;
  summary?: string;
}

export interface EducationFlashcardRequest {
  subjectId?: string;
  topicId?: string;
  count?: number;
  difficulty?: Difficulty;
  language?: Language;
  documentIds?: string[];
}

export interface EducationFlashcardGenerateResponse {
  flashcards: FlashcardData[];
}

export interface EducationFlashcardReviewRequest {
  flashcardId: string;
  rating: FlashcardRating;
}

export interface EducationFlashcardReviewResponse {
  nextReviewAt: Date;
  interval: number;
  easeFactor: number;
  repetitions: number;
}

export interface EducationStudyPlanRequest {
  subjectId: string;
  name: string;
  examDate?: Date;
  totalHours?: number;
  dailyHours?: number;
  startDate?: Date;
  topics?: string[];
}

export interface EducationStudyPlanResponse {
  plan: StudyPlanData;
}

export interface EducationProgressResponse {
  overall: StudyProgressData;
  bySubject: StudyProgressData[];
  byTopic: StudyProgressData[];
  weakTopics: WeakTopic[];
  recentActivity: StudyActivityLog[];
}

export interface WeakTopic {
  topicId: string;
  topicName: string;
  subjectName: string;
  accuracy: number;
  questionsAttempted: number;
  recommendedActions: string[];
}

export interface StudyActivityLog {
  id: string;
  type: "quiz" | "flashcard" | "explanation" | "viva" | "study_plan";
  subjectName?: string;
  topicName?: string;
  durationMinutes: number;
  score?: number;
  createdAt: Date;
}

export interface EducationChatRequest {
  message: string;
  mode: EducationMode;
  context?: {
    subjectId?: string;
    topicId?: string;
    documentIds?: string[];
    language?: Language;
    level?: ExplanationLevel;
  };
}

export interface EducationChatResponse {
  response: string;
  citations: EducationCitation[];
  suggestedActions: EducationAction[];
}

export interface EducationAction {
  type: "explain" | "quiz" | "flashcard" | "viva" | "evaluate" | "study_plan";
  label: string;
  payload?: Record<string, unknown>;
}

export interface EducationDocumentQuestionRequest {
  documentIds: string[];
  question: string;
  language?: Language;
  mode?: "answer" | "summarize" | "explain" | "mcq" | "flashcard";
}

export interface EducationDocumentQuestionResponse {
  answer: string;
  citations: EducationCitation[];
  relatedQuestions: string[];
}