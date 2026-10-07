# Sources

ai-co2 works with assumptions, and each one has a source. The page shows a short source line and one link beside each slider. This file holds the full citations, one entry per assumption, in the order of the page's table.

- **Source line** is the line the page shows, word for word.
- **Link** is the link the page shows with it.
- **Citation** is the full reference. The page does not show it.
- **Thin evidence** marks an assumption that rests on little evidence. The page marks its slider too.

Every entry was checked on 7 October 2026. The values themselves (low, typical and high) are on the page, in the section "How it's calculated", and in [`src/model/assumptions.ts`](src/model/assumptions.ts). This file does not repeat them.

Several source lines say "our assumption" or "our estimate". Those values are choices of this project, not published figures. Where such an entry has a link, the link leads to the figure the choice started from.

If a source says something else than this file or the page claims, or a newer source exists, please open an issue: https://github.com/squaloo-studio/ai-co2/issues


## Energy

### Energy to write 1,000 tokens, small models

- **Source line:** EcoLogits 0.11.1 (an estimate; 0.11.2 is the newest release)
- **Link:** https://ecologits.ai/latest/methodology/llm_inference/
- **Citation:** Rincé, S. and Banse, A. (2025). EcoLogits: Evaluating the Environmental Impacts of Generative AI. Journal of Open Source Software 10(111), 7471. https://doi.org/10.21105/joss.07471

### Energy to write 1,000 tokens, mid-size models

- **Source line:** Epoch AI (2025) for the middle, which already includes some data-centre overhead; EcoLogits 0.11.1 for the high end; the low end has thin support
- **Link:** https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use
- **Citation:** You, J. (7 Feb 2025). How much energy does ChatGPT use? Epoch AI, Gradient Updates. Also EcoLogits as above, and Chung, J.-W. et al. (2026). Where Do the Joules Go? arXiv:2601.22076. https://arxiv.org/abs/2601.22076

### Energy to write 1,000 tokens, large models

- **Source line:** Oviedo et al., Joule (2026) for the low end and middle, which already include data-centre overhead; EcoLogits 0.11.1 for the high end
- **Link:** https://arxiv.org/abs/2509.20241
- **Citation:** Oviedo, F., Kazhamiaka, F., Choukse, E., Kim, A., Luers, A., Nakagawa, M., Bianchini, R. and Lavista Ferres, J. M. (2026). Energy use of AI inference, efficiency pathways, and test-time scaling. Joule 10(8), 102430. https://doi.org/10.1016/j.joule.2026.102430

### Energy to write 1,000 tokens, Fable

- **Source line:** Our assumption: twice the large high end. EcoLogits 0.11.2's own formula gives up to 18 Wh
- **Link:** https://platform.claude.com/docs/en/about-claude/pricing
- **Citation:** Anthropic, Pricing (list prices); EcoLogits as above.
- **Thin evidence:** yes

### Energy to write 1,000 tokens, models we don't know

- **Source line:** Our assumption: the small low end, the mid-size middle and the large high end
- **Link:** none
- **Citation:** none. The value is our own, as the source line says.
- **Thin evidence:** yes


## Input and cache

### Reading a new token, compared with writing one

- **Source line:** Delavande et al. (2026), Caravaca et al. (2025), Epoch AI (2025). Epoch's own numbers give 0.66 for a 100,000-token input
- **Link:** https://arxiv.org/abs/2511.05597
- **Citation:** Caravaca, F., Cuevas, Á. and Cuevas, R. (2025). From Prompts to Power: Measuring the Energy Footprint of LLM Inference. arXiv:2511.05597. Delavande, J., Pierrard, R. and Luccioni, S. (2026). Small Talk, Big Impact: The Energy Cost of Thanking AI. arXiv:2601.22357. https://arxiv.org/abs/2601.22357 . You, J. (2025), as above.

### Storing a token for re-use, compared with writing one

- **Source line:** Our assumption: equal to fresh input, with a top end taken from a price ratio, not from a measurement
- **Link:** https://platform.claude.com/docs/en/about-claude/pricing
- **Citation:** Anthropic, Pricing (cache write at 1.25 times the input price).
- **Thin evidence:** yes

### Re-reading a stored token, compared with writing one

- **Source line:** The low end and middle follow price ratios. The one measurement (Irminsul, 2026, short texts) implies 0.004 and 0.02 to 0.06
- **Link:** https://arxiv.org/abs/2605.05696
- **Citation:** Ma, B., Eitzinger, J. and Köstler, H. (2026). Irminsul: MLA-Native Position-Independent Caching for Agentic LLM Serving. arXiv:2605.05696. Anthropic, Pricing (cache read at 0.1 times the input price).
- **Thin evidence:** yes


## Data centre, grid and hardware

### Data-centre overhead

- **Source line:** Google, Amazon and Microsoft, 2025 figures for their whole fleets
- **Link:** https://datacenters.google/efficiency/
- **Citation:** Google, Data center efficiency. Amazon (2026), 2025 Amazon Sustainability Report: AWS Summary, https://sustainability.aboutamazon.com/2025-aws-summary.pdf . Microsoft, Measuring energy and water efficiency for Microsoft datacenters, https://datacenters.microsoft.com/sustainability/efficiency/

### CO₂ per unit of electricity

- **Source line:** US EPA eGRID2023 for the low end and middle (power plants only); Ember 2026 for the high end (whole life cycle)
- **Link:** https://www.epa.gov/egrid/summary-data
- **Citation:** US EPA (2025). eGRID2023 Summary Tables, revision 2. Fulghum, N., Altieri, K., Rangelova, K. and Suarez, W. (21 Apr 2026). Global Electricity Review 2026. Ember. https://ember-energy.org/latest-insights/global-electricity-review-2026/

### Making the hardware, as a factor on top

- **Source line:** Schneider et al. (2025) and Elsworth et al. (2025), both about Google's own hardware. The middle value is our choice
- **Link:** https://arxiv.org/abs/2502.01671
- **Citation:** Schneider, I. et al. (2025). Life-Cycle Emissions of AI Hardware: A Cradle-To-Grave Approach and Generational Trends. arXiv:2502.01671. Elsworth, C. et al. (2025). Measuring the environmental impact of delivering AI at Google Scale. arXiv:2508.15734. https://arxiv.org/abs/2508.15734
- **Thin evidence:** yes


## Hidden work in ChatGPT

### Thinking tokens per second of thinking

- **Source line:** Output speeds measured by Artificial Analysis. The step from seconds to tokens is our assumption
- **Link:** https://artificialanalysis.ai/models/gpt-5
- **Citation:** Artificial Analysis, model pages for the GPT-5.5, GPT-5.6 and GPT-6 families (about 40 to 160 output tokens per second).
- **Thin evidence:** yes

### Hidden instructions, tokens each time ChatGPT answers

- **Source line:** Copies of ChatGPT's instructions published by users, counted by us. They cannot be verified
- **Link:** https://github.com/asgeirtj/system_prompts_leaks
- **Citation:** The folder `OpenAI` in the collection at https://github.com/asgeirtj/system_prompts_leaks , and the collection at https://github.com/jujumilk3/leaked-system-prompts .
- **Thin evidence:** yes

### Memory and custom instructions, tokens each time ChatGPT answers

- **Source line:** Added up by us from a few published examples. Not a measurement
- **Link:** https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/
- **Citation:** The write-up at https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/ , and the memory block inside the copies of ChatGPT's instructions named in the entry before this one.
- **Thin evidence:** yes

### Web text read, tokens per source

- **Source line:** One official figure: OpenAI bills 8,000 tokens per search on two small models. The rest is our estimate
- **Link:** https://developers.openai.com/api/docs/pricing
- **Citation:** OpenAI, API pricing, "search content tokens".
- **Thin evidence:** yes

### Uploaded file with no size in the export, tokens per file

- **Source line:** Our own count of 35 files in four public exports
- **Link:** none
- **Citation:** none. The value is our own, as the source line says.
- **Thin evidence:** yes

### Share of quick replies where re-use fails

- **Source line:** Our assumption. OpenAI documents re-use for its developer service, not for ChatGPT
- **Link:** https://developers.openai.com/api/docs/guides/prompt-caching
- **Citation:** OpenAI, Prompt caching guide.
- **Thin evidence:** yes

## Two fixed numbers without a slider

The page states both in the section "How it's calculated".

### The car: 160 g CO₂ per km

- **Source line:** EEA provisional 2025 data, new petrol cars without hybrid drive (136.6 g/km, our own average of the EEA's table), times the ICCT's 19% real-world gap for cars registered in 2023. Checked 7 Oct 2026.
- **Links:** https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b and https://theicct.org/publication/real-world-co2-emission-values-vehicles-europe-jun26/

### The clean-power figure: 70 g CO₂ per kWh

- **Source line:** Worked out from Google's and Microsoft's 2026 environmental reports (65 and 73). The figure swings from year to year: one year earlier it was 91 and 9. Checked 7 Oct 2026.
- **Link:** none

The page shows this figure only for comparison. The estimate does not use it.

## Places beside the car figure

The page names a real distance of about the car figure's middle, from a list of 26 places, roughly one step every ×1.5 from a tennis court to the drive from Tarifa to the North Cape. It picks the one closest on a log scale, so twice as far and half as far count the same. Beyond the longest drive by more than 30%, it says how far towards the Moon the distance goes. Below the shortest place by more than a third, it names none. Checked 7 Oct 2026.

- **Drives:** the fastest route on OpenStreetMap, worked out with OSRM, between main stations or city centres. Map data © OpenStreetMap contributors: https://www.openstreetmap.org/copyright
- **Fixed lengths:** each from the body that owns it: ITF Rules of Tennis 2026 (tennis court), World Aquatics (Olympic pool), FIFA Football Stadiums Guidelines (football pitch), World Athletics Technical Rules (running track), City of Paris (Champs-Élysées), Golden Gate Bridge District, Honshu-Shikoku Bridge Expressway (Akashi Kaikyō Bridge), Øresundsbron, Vinci Concessions (Vasco da Gama Bridge).
- **The Moon:** 384,400 km on average, from NASA: https://science.nasa.gov/moon/facts/

The list is in `src/model/places.ts`.
