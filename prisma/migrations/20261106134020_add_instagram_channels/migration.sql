-- CreateTable
CREATE TABLE "instagram_channels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instagramUserId" TEXT NOT NULL,
    "username" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_oauth_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instagram_channels_instagramUserId_key" ON "instagram_channels"("instagramUserId");

-- CreateIndex
CREATE INDEX "instagram_channels_userId_idx" ON "instagram_channels"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_oauth_states_stateHash_key" ON "instagram_oauth_states"("stateHash");

-- CreateIndex
CREATE INDEX "instagram_oauth_states_userId_idx" ON "instagram_oauth_states"("userId");

-- CreateIndex
CREATE INDEX "instagram_oauth_states_expiresAt_idx" ON "instagram_oauth_states"("expiresAt");

-- AddForeignKey
ALTER TABLE "instagram_channels" ADD CONSTRAINT "instagram_channels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_oauth_states" ADD CONSTRAINT "instagram_oauth_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
