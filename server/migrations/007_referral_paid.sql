-- Деньги пригласившему — только когда друг дошёл до REFERRAL.minLevel. Старые приглашения уже оплачены (paid = 1).
ALTER TABLE referrals ADD COLUMN paid INTEGER NOT NULL DEFAULT 1;
