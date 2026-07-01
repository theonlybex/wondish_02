-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED', 'PAST_DUE', 'TRIALING', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "MealPlanStatus" AS ENUM ('IDLE', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'DELIVERED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('ADMIN', 'PREMIUM');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "password" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "photoUrl" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "agreedTerms" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "countryId" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRole" (
    "accountId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "AccountRole_pkey" PRIMARY KEY ("accountId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "stripeCurrentPeriodEnd" TIMESTAMP(3),
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "trialEndsAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "birthday" TIMESTAMP(3),
    "sexAtBirth" TEXT,
    "genderId" TEXT,
    "weight" DOUBLE PRECISION,
    "weightUnit" TEXT DEFAULT 'lbs',
    "height" DOUBLE PRECISION,
    "heightUnit" TEXT DEFAULT 'ftin',
    "heightFt" INTEGER,
    "heightIn" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "physicalActivityId" TEXT,
    "mealTypeId" TEXT,
    "goalWeight" DOUBLE PRECISION,
    "goalWeightUnit" TEXT DEFAULT 'lbs',
    "weeklyGoal" DOUBLE PRECISION,
    "mealPlanStartDate" TIMESTAMP(3),
    "activePlanVersion" INTEGER NOT NULL DEFAULT 0,
    "mealPlanStatus" "MealPlanStatus" NOT NULL DEFAULT 'IDLE',
    "mealPlanStale" BOOLEAN NOT NULL DEFAULT false,
    "mealPlanGenStartedAt" TIMESTAMP(3),
    "mealPlanError" TEXT,
    "mealPlanWeight" DOUBLE PRECISION,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "tasteCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gender" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Gender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalActivity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PhysicalActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Motivation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Motivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationBannedIngredient" (
    "id" TEXT NOT NULL,
    "motivationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "MotivationBannedIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientMotivation" (
    "patientId" TEXT NOT NULL,
    "motivationId" TEXT NOT NULL,

    CONSTRAINT "PatientMotivation_pkey" PRIMARY KEY ("patientId","motivationId")
);

-- CreateTable
CREATE TABLE "FoodPreference" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FoodPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodPreferenceBannedIngredient" (
    "id" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FoodPreferenceBannedIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientFoodPreference" (
    "patientId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,

    CONSTRAINT "PatientFoodPreference_pkey" PRIMARY KEY ("patientId","foodId")
);

-- CreateTable
CREATE TABLE "FoodToAvoid" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FoodToAvoid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientFoodToAvoid" (
    "patientId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,

    CONSTRAINT "PatientFoodToAvoid_pkey" PRIMARY KEY ("patientId","foodId")
);

-- CreateTable
CREATE TABLE "FoodAllergy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FoodAllergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodAllergyBannedIngredient" (
    "id" TEXT NOT NULL,
    "allergyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FoodAllergyBannedIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientFoodAllergy" (
    "patientId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,

    CONSTRAINT "PatientFoodAllergy_pkey" PRIMARY KEY ("patientId","foodId")
);

-- CreateTable
CREATE TABLE "HealthCondition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "HealthCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthConditionBannedIngredient" (
    "id" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "HealthConditionBannedIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientHealthCondition" (
    "patientId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,

    CONSTRAINT "PatientHealthCondition_pkey" PRIMARY KEY ("patientId","conditionId")
);

-- CreateTable
CREATE TABLE "PatientDishPreference" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "liked" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientDishPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCustomIngredient" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calories" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientCustomIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "emoji" TEXT,
    "calories" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION,
    "prepTime" INTEGER,
    "cookTime" INTEGER,
    "servings" INTEGER DEFAULT 1,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[],
    "family" TEXT,
    "subFamily" TEXT,
    "dishTypeId" TEXT,
    "mealTypeId" TEXT,
    "ethnicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "calories" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("recipeId","ingredientId")
);

-- CreateTable
CREATE TABLE "MealType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "MealType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DishType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "DishType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ethnic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Ethnic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "mealTypeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "mood" TEXT,
    "weight" DOUBLE PRECISION,
    "energyLevel" TEXT,
    "activityLevel" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalMeal" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "preparation" TEXT,
    "recipeId" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION,

    CONSTRAINT "JournalMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL DEFAULT 'PREMIUM',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsAndConditions" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsAndConditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZipCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ZipCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_clerkId_key" ON "Account"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_accountId_key" ON "Subscription"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_accountId_key" ON "Patient"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Gender_name_key" ON "Gender"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalActivity_name_key" ON "PhysicalActivity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Motivation_name_key" ON "Motivation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MotivationBannedIngredient_motivationId_name_key" ON "MotivationBannedIngredient"("motivationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodPreference_name_key" ON "FoodPreference"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodPreferenceBannedIngredient_preferenceId_name_key" ON "FoodPreferenceBannedIngredient"("preferenceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodToAvoid_name_key" ON "FoodToAvoid"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodAllergy_name_key" ON "FoodAllergy"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodAllergyBannedIngredient_allergyId_name_key" ON "FoodAllergyBannedIngredient"("allergyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HealthCondition_name_key" ON "HealthCondition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "HealthConditionBannedIngredient_conditionId_name_key" ON "HealthConditionBannedIngredient"("conditionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PatientDishPreference_patientId_recipeId_key" ON "PatientDishPreference"("patientId", "recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_name_key" ON "Ingredient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MealType_name_key" ON "MealType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DishType_name_key" ON "DishType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Ethnic_name_key" ON "Ethnic"("name");

-- CreateIndex
CREATE INDEX "Menu_patientId_planVersion_date_idx" ON "Menu"("patientId", "planVersion", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_patientId_date_idx" ON "JournalEntry"("patientId", "date");

-- CreateIndex
CREATE INDEX "JournalMeal_journalEntryId_idx" ON "JournalMeal"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Country_name_key" ON "Country"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_accountId_key" ON "CouponRedemption"("couponId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TermsAndConditions_version_key" ON "TermsAndConditions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "ZipCode_code_key" ON "ZipCode"("code");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRole" ADD CONSTRAINT "AccountRole_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRole" ADD CONSTRAINT "AccountRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_genderId_fkey" FOREIGN KEY ("genderId") REFERENCES "Gender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_physicalActivityId_fkey" FOREIGN KEY ("physicalActivityId") REFERENCES "PhysicalActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_mealTypeId_fkey" FOREIGN KEY ("mealTypeId") REFERENCES "MealType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationBannedIngredient" ADD CONSTRAINT "MotivationBannedIngredient_motivationId_fkey" FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMotivation" ADD CONSTRAINT "PatientMotivation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMotivation" ADD CONSTRAINT "PatientMotivation_motivationId_fkey" FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPreferenceBannedIngredient" ADD CONSTRAINT "FoodPreferenceBannedIngredient_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "FoodPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFoodPreference" ADD CONSTRAINT "PatientFoodPreference_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFoodPreference" ADD CONSTRAINT "PatientFoodPreference_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodPreference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFoodToAvoid" ADD CONSTRAINT "PatientFoodToAvoid_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFoodToAvoid" ADD CONSTRAINT "PatientFoodToAvoid_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodToAvoid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodAllergyBannedIngredient" ADD CONSTRAINT "FoodAllergyBannedIngredient_allergyId_fkey" FOREIGN KEY ("allergyId") REFERENCES "FoodAllergy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFoodAllergy" ADD CONSTRAINT "PatientFoodAllergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFoodAllergy" ADD CONSTRAINT "PatientFoodAllergy_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodAllergy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthConditionBannedIngredient" ADD CONSTRAINT "HealthConditionBannedIngredient_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHealthCondition" ADD CONSTRAINT "PatientHealthCondition_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHealthCondition" ADD CONSTRAINT "PatientHealthCondition_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDishPreference" ADD CONSTRAINT "PatientDishPreference_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDishPreference" ADD CONSTRAINT "PatientDishPreference_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCustomIngredient" ADD CONSTRAINT "PatientCustomIngredient_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_dishTypeId_fkey" FOREIGN KEY ("dishTypeId") REFERENCES "DishType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_mealTypeId_fkey" FOREIGN KEY ("mealTypeId") REFERENCES "MealType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_ethnicId_fkey" FOREIGN KEY ("ethnicId") REFERENCES "Ethnic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_mealTypeId_fkey" FOREIGN KEY ("mealTypeId") REFERENCES "MealType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalMeal" ADD CONSTRAINT "JournalMeal_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

