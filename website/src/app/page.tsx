import { HeroSection } from '@/components/HeroSection';
import { VisionSection } from '@/components/VisionSection';
import { EcosystemSection } from '@/components/EcosystemSection';
import { FeaturesSection } from '@/components/FeaturesSection';
import { TokenomicsSection } from '@/components/TokenomicsSection';
import { WhyETIMSection } from '@/components/WhyETIMSection';

export default function Home() {
  return (
    <>
      <HeroSection />
      <VisionSection />
      <EcosystemSection />
      <FeaturesSection />
      <TokenomicsSection />
      <WhyETIMSection />
    </>
  );
}
