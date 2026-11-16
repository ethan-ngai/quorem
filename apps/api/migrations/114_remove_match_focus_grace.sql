ALTER TABLE matches ALTER COLUMN rules SET DEFAULT '{"victory":"race","settingsEditors":"host","clipboard":"announce","copy":"off","focus":"announce","behavioralSeconds":15,"behavioralPoints":2,"focusFreeWarnings":1,"assistance":{"topics":{"access":"penalty","seconds":30,"points":3},"complexity":{"access":"penalty","seconds":60,"points":5},"hiddenCase":{"access":"penalty","seconds":120,"points":10}},"submissions":{"cooldownSeconds":10,"freeSubmissions":3,"seconds":0,"points":0},"automaticImports":false}'::jsonb;

UPDATE matches SET rules = rules - 'focusGraceSeconds' WHERE rules ? 'focusGraceSeconds';
UPDATE parties
SET settings = settings #- '{rules,focusGraceSeconds}'
WHERE settings->'rules' ? 'focusGraceSeconds';
