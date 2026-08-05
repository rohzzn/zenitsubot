-- The /animealert command has been removed: Jikan's anime/{id}/episodes
-- endpoint returns 504, so new-episode alerts could never fire. The table had
-- no rows, so nothing is lost by dropping it.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AnimeAlert";
PRAGMA foreign_keys=on;
