-- Optional seed data — run AFTER schema.sql (once) to pre-load the
-- Cambridge-style subject list. You can also add subjects in the app.

insert into public.subjects (name, sort_order) values
  ('English', 1),
  ('Mathematics', 2),
  ('Science', 3),
  ('Kiswahili', 4),
  ('Global Perspectives', 5),
  ('History', 6),
  ('Geography', 7),
  ('ICT / Computer Science', 8),
  ('Art & Design', 9),
  ('Music', 10),
  ('Physical Education', 11),
  ('French', 12),
  ('Spanish', 13),
  ('Biology', 14),
  ('Chemistry', 15),
  ('Physics', 16),
  ('Economics', 17),
  ('Business Studies', 18),
  ('Literature in English', 19),
  ('Accounting', 20),
  ('Computer Science', 21);
