import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const learnerProfiles = sqliteTable(
  "learner_profiles",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    displayName: text("display_name").notNull(),
    ageBand: text("age_band").notNull().default("not-specified"),
    homeLanguages: text("home_languages").notNull().default("[]"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("learner_profiles_owner_idx").on(table.ownerEmail)],
);
export const skillProgress = sqliteTable(
  "skill_progress",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id").notNull().references(() => learnerProfiles.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id").notNull(),
    sessionId: text("session_id").notNull(),
    skill: text("skill").notNull(),
    status: text("status").notNull().default("complete"),
    score: integer("score"),
    evidence: text("evidence").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("skill_progress_profile_session_unique").on(table.profileId, table.sessionId),
    index("skill_progress_profile_idx").on(table.profileId),
    index("skill_progress_lesson_idx").on(table.lessonId),
  ],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    profileId: text("profile_id").notNull().references(() => learnerProfiles.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id").notNull(),
    sessionId: text("session_id"),
    title: text("title").notNull(),
    dueAt: text("due_at"),
    status: text("status").notNull().default("assigned"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("assignments_owner_idx").on(table.ownerEmail),
    index("assignments_profile_idx").on(table.profileId),
  ],
);

export const curriculumDrafts = sqliteTable(
  "curriculum_drafts",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    lessonId: text("lesson_id"),
    title: text("title").notNull(),
    level: text("level").notNull(),
    status: text("status").notNull().default("draft"),
    dataJson: text("data_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("curriculum_drafts_owner_idx").on(table.ownerEmail)],
);

export const contentReviews = sqliteTable(
  "content_reviews",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    lessonId: text("lesson_id").notNull(),
    reviewType: text("review_type").notNull(),
    reviewerName: text("reviewer_name").notNull().default(""),
    reviewerEmail: text("reviewer_email").notNull().default(""),
    status: text("status").notNull().default("not-started"),
    notes: text("notes").notNull().default(""),
    reviewedAt: text("reviewed_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("content_review_lesson_type_unique").on(table.ownerEmail, table.lessonId, table.reviewType),
    index("content_reviews_lesson_idx").on(table.lessonId),
  ],
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    lessonId: text("lesson_id").notNull(),
    slot: text("slot").notNull(),
    objectKey: text("object_key").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    speakerName: text("speaker_name").notNull().default(""),
    dialect: text("dialect").notNull().default("Bangladesh standard"),
    consentConfirmed: integer("consent_confirmed", { mode: "boolean" }).notNull().default(false),
    reviewStatus: text("review_status").notNull().default("pending"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("media_assets_object_key_unique").on(table.objectKey),
    index("media_assets_slot_idx").on(table.lessonId, table.slot),
    index("media_assets_owner_idx").on(table.ownerEmail),
  ],
);

export const videoReviews = sqliteTable(
  "video_reviews",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    lessonId: text("lesson_id").notNull(),
    videoId: text("video_id").notNull(),
    status: text("status").notNull().default("pending"),
    captionsStatus: text("captions_status").notNull().default("unchecked"),
    suitabilityStatus: text("suitability_status").notNull().default("unchecked"),
    replacementUrl: text("replacement_url").notNull().default(""),
    notes: text("notes").notNull().default(""),
    checkedAt: text("checked_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("video_reviews_lesson_unique").on(table.ownerEmail, table.lessonId),
    index("video_reviews_owner_idx").on(table.ownerEmail),
  ],
);

export const adults = sqliteTable(
  "adults",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["parent", "teacher", "admin"] }).notNull().default("parent"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    teacherStatus: text("teacher_status", { enum: ["none", "pending", "approved", "rejected"] }).notNull().default("none"),
    teacherRequestedAt: text("teacher_requested_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("adults_email_unique").on(table.email), index("adults_access_idx").on(table.role, table.status, table.teacherStatus)],
);

export const adultSessions = sqliteTable(
  "adult_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    adultId: text("adult_id").notNull().references(() => adults.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("adult_sessions_adult_idx").on(table.adultId)],
);

export const classes = sqliteTable(
  "classes",
  {
    id: text("id").primaryKey(),
    teacherId: text("teacher_id").notNull().references(() => adults.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    joinCode: text("join_code").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("classes_join_code_unique").on(table.joinCode),
    index("classes_teacher_idx").on(table.teacherId),
  ],
);

export const classStudents = sqliteTable(
  "class_students",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("class_students_token_unique").on(table.tokenHash),
    index("class_students_class_idx").on(table.classId),
  ],
);

export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    // Set for teacher-provisioned accounts until the student replaces the temporary password.
    mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("students_username_unique").on(table.username)],
);

export const parentStudentLinks = sqliteTable("parent_student_links", {
  id: text("id").primaryKey(),
  parentId: text("parent_id").notNull().references(() => adults.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("parent_student_links_pair_unique").on(table.parentId, table.studentId),
  index("parent_student_links_student_idx").on(table.studentId),
]);

export const studentSessions = sqliteTable(
  "student_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("student_sessions_student_idx").on(table.studentId)],
);

export const studentClassEnrollments = sqliteTable(
  "student_class_enrollments",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    classId: text("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    classStudentId: text("class_student_id").notNull().references(() => classStudents.id, { onDelete: "cascade" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("student_enrollments_student_class_unique").on(table.studentId, table.classId),
    uniqueIndex("student_enrollments_class_student_unique").on(table.classStudentId),
    index("student_enrollments_student_idx").on(table.studentId),
    index("student_enrollments_class_idx").on(table.classId),
  ],
);

export const classActivities = sqliteTable(
  "class_activities",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    topicId: text("topic_id"),
    questionsJson: text("questions_json").notNull().default("[]"),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("class_activities_class_idx").on(table.classId)],
);

export const activitySubmissions = sqliteTable(
  "activity_submissions",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id").notNull().references(() => classActivities.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull().references(() => classStudents.id, { onDelete: "cascade" }),
    answersJson: text("answers_json").notNull().default("[]"),
    score: integer("score").notNull().default(0),
    total: integer("total").notNull().default(0),
    submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("activity_submissions_unique").on(table.activityId, table.studentId),
    index("activity_submissions_activity_idx").on(table.activityId),
  ],
);

export const classAnnouncements = sqliteTable(
  "class_announcements",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("class_announcements_class_idx").on(table.classId)],
);

export const knowledgeSources = sqliteTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    updatedBy: text("updated_by").notNull().default(""),
    dataJson: text("data_json").notNull().default("{}"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    adultId: text("adult_id").notNull().references(() => adults.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("recovery_codes_adult_idx").on(table.adultId),
    uniqueIndex("recovery_codes_hash_unique").on(table.codeHash),
  ],
);

export const userAuditEvents = sqliteTable("user_audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  targetId: text("target_id").notNull(),
  targetType: text("target_type").notNull(),
  action: text("action").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("user_audit_target_idx").on(table.targetId)]);

export const topicUpdates = sqliteTable("topic_updates", {
  topicId: text("topic_id").primaryKey(),
  dataJson: text("data_json").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const studentTopicProgress = sqliteTable("student_topic_progress", {
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  topicId: text("topic_id").notNull(),
  completedAt: text("completed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("student_topic_progress_unique").on(table.studentId, table.topicId)]);
