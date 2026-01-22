BEGIN;

-- Remplace par l'UUID réel
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM profiles
  WHERE email = 'softura242@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE profiles
  SET role = 'ADMIN'
  WHERE id = v_user_id;

  UPDATE auth.users
  SET raw_user_meta_data =
    COALESCE(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'ADMIN')
  WHERE id = v_user_id;
END $$;

COMMIT;
