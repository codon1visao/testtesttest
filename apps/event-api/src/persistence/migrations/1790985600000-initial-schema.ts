import type { MigrationInterface, QueryRunner } from "typeorm";

// T4 §4: the DDL is the source of truth. MySQL DDL commits implicitly, so the migration
// runs without a wrapping transaction (data-source.ts: migrationsTransactionMode "none").
const CREATE_STATEMENTS: readonly string[] = [
  `CREATE TABLE events (
  id                     VARCHAR(16)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name                   VARCHAR(120) NOT NULL,
  club_name              VARCHAR(120) NOT NULL,
  status                 ENUM('ended') NOT NULL,
  attendance_revision    INT UNSIGNED NOT NULL DEFAULT 0,
  briefing_revision      INT UNSIGNED NOT NULL DEFAULT 0,
  next_feedback_number   INT UNSIGNED NOT NULL,
  feedback_pending_since DATETIME(3)  NULL,
  created_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE members (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name          VARCHAR(120) NOT NULL,
  attendance    ENUM('attended','absent','not_recorded') NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, id),
  UNIQUE KEY uq_members_order (event_id, display_order),
  CONSTRAINT fk_members_event FOREIGN KEY (event_id) REFERENCES events (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE feedback_notes (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  text          VARCHAR(1000) NOT NULL,
  origin        ENUM('seed','submitted') NOT NULL,
  submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  received_at   DATETIME(3) NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, id),
  UNIQUE KEY uq_feedback_submission (event_id, submission_id),
  UNIQUE KEY uq_feedback_order (event_id, display_order),
  CONSTRAINT fk_feedback_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT ck_feedback_text CHECK (CHAR_LENGTH(TRIM(text)) > 0),
  CONSTRAINT ck_feedback_origin CHECK ((origin = 'seed') = (submission_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE briefing_generations (
  id                  CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_id              VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  trigger_type        ENUM('manual','feedback_batch') NOT NULL,
  model               VARCHAR(100) NOT NULL,
  prompt_version      VARCHAR(32)  NOT NULL,
  attendance_overview VARCHAR(500) NOT NULL,
  feedback_digest     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_captured_at   DATETIME(3) NOT NULL,
  generated_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_generation_run (run_id),
  UNIQUE KEY uq_generation_event (event_id, id),
  CONSTRAINT fk_generation_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT ck_generation_overview CHECK (CHAR_LENGTH(TRIM(attendance_overview)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE generation_attendance_inputs (
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  member_id     VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attendance    ENUM('attended','absent','not_recorded') NOT NULL,
  PRIMARY KEY (generation_id, member_id),
  CONSTRAINT fk_att_input_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_att_input_member FOREIGN KEY (event_id, member_id) REFERENCES members (event_id, id)
) ENGINE=InnoDB`,
  `CREATE TABLE generation_feedback_inputs (
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feedback_id   VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (generation_id, feedback_id),
  CONSTRAINT fk_fb_input_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_fb_input_note FOREIGN KEY (event_id, feedback_id) REFERENCES feedback_notes (event_id, id)
) ENGINE=InnoDB`,
  `CREATE TABLE briefing_items (
  id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  section       ENUM('summary','theme','conflict','suggestion') NOT NULL,
  position      TINYINT UNSIGNED NOT NULL,
  text          VARCHAR(1000) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_position (generation_id, section, position),
  UNIQUE KEY uq_item_generation (generation_id, id),
  CONSTRAINT fk_item_generation FOREIGN KEY (generation_id) REFERENCES briefing_generations (id) ON DELETE CASCADE,
  CONSTRAINT ck_item_position CHECK (position < 10),
  CONSTRAINT ck_item_summary CHECK (section <> 'summary' OR (position = 0 AND CHAR_LENGTH(text) <= 600)),
  CONSTRAINT ck_item_text CHECK (CHAR_LENGTH(TRIM(text)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE briefing_item_sources (
  item_id       CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feedback_id   VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position      TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (item_id, feedback_id),
  UNIQUE KEY uq_source_position (item_id, position),
  CONSTRAINT fk_source_item FOREIGN KEY (generation_id, item_id)
    REFERENCES briefing_items (generation_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_source_input FOREIGN KEY (generation_id, feedback_id)
    REFERENCES generation_feedback_inputs (generation_id, feedback_id) ON DELETE CASCADE,
  CONSTRAINT ck_source_position CHECK (position < 8)
) ENGINE=InnoDB`,
  `CREATE TABLE preview_slots (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot          ENUM('selected','incoming') NOT NULL,
  generation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at    DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id, slot),
  UNIQUE KEY uq_slot_generation (generation_id),
  CONSTRAINT fk_slot_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
  `CREATE TABLE saved_briefings (
  event_id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id       CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attendance_overview VARCHAR(500) NOT NULL,
  saved_at            DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_saved_generation (event_id, generation_id),
  CONSTRAINT fk_saved_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_saved_overview CHECK (CHAR_LENGTH(TRIM(attendance_overview)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE saved_briefing_items (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id       CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  text          VARCHAR(1000) NOT NULL,
  PRIMARY KEY (event_id, item_id),
  CONSTRAINT fk_saved_item_briefing FOREIGN KEY (event_id, generation_id)
    REFERENCES saved_briefings (event_id, generation_id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_item_item FOREIGN KEY (generation_id, item_id)
    REFERENCES briefing_items (generation_id, id),
  CONSTRAINT ck_saved_item_text CHECK (CHAR_LENGTH(TRIM(text)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE generation_outcomes (
  run_id        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  trigger_type  ENUM('manual','feedback_batch') NOT NULL,
  status        ENUM('succeeded','failed','skipped','superseded','superseded_by_manual') NOT NULL,
  error_code    VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  finished_at   DATETIME(3) NOT NULL,
  PRIMARY KEY (run_id),
  KEY ix_outcomes_recent (event_id, finished_at),
  CONSTRAINT fk_outcome_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT ck_outcome_error CHECK ((status = 'failed') = (error_code IS NOT NULL))
) ENGINE=InnoDB`,
];

/** Drop order: children before parents. */
export const SCHEMA_TABLES_CHILD_FIRST = [
  "saved_briefing_items",
  "saved_briefings",
  "preview_slots",
  "briefing_item_sources",
  "briefing_items",
  "generation_feedback_inputs",
  "generation_attendance_inputs",
  "generation_outcomes",
  "briefing_generations",
  "feedback_notes",
  "members",
  "events",
] as const;

export class InitialSchema1790985600000 implements MigrationInterface {
  name = "InitialSchema1790985600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of CREATE_STATEMENTS) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of SCHEMA_TABLES_CHILD_FIRST)
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
}
