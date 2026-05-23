-- Fullbacks now have their own match-rating bucket and config surface.

UPDATE public.match_ratings mr
SET position = 'FB'
FROM public.players p
WHERE p.id = mr.player_id
  AND UPPER(TRIM(p.position)) IN ('LB', 'RB', 'LWB', 'RWB')
  AND mr.position = 'DEF';
