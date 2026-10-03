-- Integration tests use a separate database so they never touch event_desk (T3 §12).
CREATE DATABASE IF NOT EXISTS event_desk_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON event_desk_test.* TO 'event_desk'@'%';
