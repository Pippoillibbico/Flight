import AITravelSection from '../../../components/AITravelSection';
import OpportunityDetailSection from '../../../components/OpportunityDetailSection';
import SectionAccessGate from '../../../components/SectionAccessGate';

export default function AiTravelMainSection({
  isAuthenticated,
  t,
  language,
  aiTravelPrompt,
  setAiTravelPrompt,
  aiTravelLoading,
  aiTravelResult,
  aiTravelError,
  runAiTravelQuery,
  openOpportunityDetail,
  userPlanType,
  canUseAiTravelPlan,
  opportunityDetailLoading,
  opportunityDetailError,
  opportunityDetail,
  opportunityBookingError,
  setOpportunityDetail,
  clearOpportunityBookingError,
  setOpportunityDetailUpgradePrompt,
  followOpportunity,
  openOpportunityBooking,
  opportunityDetailUpgradePrompt,
  upgradeToPremium,
  chooseElitePlan,
  requireSectionLogin
}) {
  if (!isAuthenticated) {
    return (
      <SectionAccessGate
        title={t('aiTravelPageTitle')}
        description={t('aiTravelPageSubtitle')}
        ctaLabel={t('signInToUseAiTravel')}
        onCta={() => requireSectionLogin('ai-travel')}
      />
    );
  }

  return (
    <>
      <AITravelSection
        t={t}
        language={language}
        prompt={aiTravelPrompt}
        setPrompt={setAiTravelPrompt}
        loading={aiTravelLoading}
        result={aiTravelResult}
        error={aiTravelError}
        onRun={runAiTravelQuery}
        onView={openOpportunityDetail}
        planType={userPlanType}
        canUseAiTravel={canUseAiTravelPlan}
        onUpgradePro={() => upgradeToPremium('ai_travel_prompt')}
        onUpgradeElite={() => chooseElitePlan('ai_travel_prompt')}
      />
      {opportunityDetailLoading || opportunityDetailError || opportunityDetail ? (
        <OpportunityDetailSection
          loading={opportunityDetailLoading}
          error={opportunityDetailError}
          detail={opportunityDetail}
          language={language}
          t={t}
          bookingError={opportunityBookingError}
          onClose={() => {
            setOpportunityDetail(null);
            clearOpportunityBookingError();
            setOpportunityDetailUpgradePrompt(null);
          }}
          onFollow={followOpportunity}
          onActivateAlert={followOpportunity}
          onOpenBooking={openOpportunityBooking}
          onViewRelated={openOpportunityDetail}
          upgradePrompt={opportunityDetailUpgradePrompt}
          onUpgradePro={() => upgradeToPremium('opportunity_detail_prompt')}
          onUpgradeElite={() => chooseElitePlan('opportunity_detail_prompt')}
        />
      ) : null}
    </>
  );
}

