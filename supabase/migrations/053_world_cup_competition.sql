-- Add the FIFA World Cup as an explicitly selectable SofaScore competition.

DO $$
BEGIN
  UPDATE public.leagues
  SET name = 'FIFA World Cup',
      country = 'International',
      fotmob_id = 77,
      understat_slug = NULL,
      tier = 1,
      sofascore_id = 16
  WHERE fotmob_id = 77
     OR sofascore_id = 16
     OR name = 'FIFA World Cup';

  IF NOT FOUND THEN
    INSERT INTO public.leagues (
      name,
      country,
      fotmob_id,
      understat_slug,
      tier,
      sofascore_id
    )
    VALUES ('FIFA World Cup', 'International', 77, NULL, 1, 16);
  END IF;
END
$$;
