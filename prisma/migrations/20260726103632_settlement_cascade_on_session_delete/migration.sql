-- DropForeignKey
ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_session_id_fkey";

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
