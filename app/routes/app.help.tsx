import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendContactEmail } from "../email.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  TextField,
  Modal,
  Box,
  Divider,
  Icon,
} from "@shopify/polaris";
import {
  ChatIcon,
  CodeIcon,
  EmailIcon,
  LightbulbIcon,
  MagicIcon,
  SettingsIcon,
  StoreManagedIcon,
  WrenchIcon,
} from "@shopify/polaris-icons";

const CONTACT_EMAIL = "damianbe86@gmail.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const type = String(formData.get("type") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const replyEmail = String(formData.get("email") ?? "").trim() || undefined;

  if (!type || !message) {
    return { ok: false, message: "Message is required." };
  }

  try {
    await prisma.contactRequest.create({
      data: {
        shop: session.shop,
        type,
        subject: subject || type,
        message,
        email: replyEmail ?? null,
      },
    });

    await sendContactEmail({
      type,
      subject: subject || type,
      message,
      replyEmail,
      shop: session.shop,
    });

    return { ok: true, message: "Message sent. We will get back to you soon." };
  } catch (error) {
    console.error("[help.action]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
};

type ModalType = "customization" | "suggestion" | "support" | null;

const customizationServices = [
  {
    icon: SettingsIcon,
    title: "Store-specific redirect logic",
    text: "Rules tuned to your catalog, URL structure, collections, vendors, tags, and merchandising strategy.",
  },
  {
    icon: StoreManagedIcon,
    title: "Cleanup workflows for your team",
    text: "Private flows for seasonal drops, brand exits, migration cleanups, QA review, and approval steps.",
  },
  {
    icon: CodeIcon,
    title: "Shopify integrations",
    text: "Connect ERP, PIM, inventory feeds, analytics, custom dashboards, or internal admin tools.",
  },
];

const requestCards = [
  {
    icon: WrenchIcon,
    title: "Customize the app",
    text: "Hire Shopify professionals to adapt Redirect Mapper Lite to how your business actually retires products.",
    action: "Request customization",
    modal: "customization" as const,
    tone: "primary",
  },
  {
    icon: LightbulbIcon,
    title: "Suggest an improvement",
    text: "Tell us what would make the app faster, smarter, or more useful for your cleanup workflow.",
    action: "Send suggestion",
    modal: "suggestion" as const,
  },
  {
    icon: ChatIcon,
    title: "Contact support",
    text: "Ask about setup, Shopify redirects, billing, rollback behavior, or anything that feels unclear.",
    action: "Contact us",
    modal: "support" as const,
  },
];

export default function Help() {
  const fetcher = useFetcher<typeof action>();
  const [openModal, setOpenModal] = useState<ModalType>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data;
  const justSucceeded = result?.ok === true && fetcher.state === "idle";

  const modalContent = {
    customization: {
      title: "Request customization",
      type: "customization",
      subjectPlaceholder: "Custom redirect workflow",
      messageLabel: "What should we build or adapt?",
      messagePlaceholder:
        "Example: Create a private rule that redirects discontinued vendor products to active products with the same product type and collection.",
      intro: "Share the business case, the catalog signals involved, and what a successful workflow should do.",
      primary: "Send request",
    },
    suggestion: {
      title: "Suggest an improvement",
      type: "suggestion",
      subjectPlaceholder: "New filter or workflow idea",
      messageLabel: "What should we add or improve?",
      messagePlaceholder:
        "Example: Add a filter for products with traffic from the last 30 days before choosing what to retire.",
      intro: "Product ideas, rough workflows, missing filters, confusing copy, and UX improvements are all useful.",
      primary: "Send suggestion",
    },
    support: {
      title: "Contact support",
      type: "support",
      subjectPlaceholder: "Question about redirects",
      messageLabel: "How can we help?",
      messagePlaceholder:
        "Example: I applied redirects but some rows failed. Can you help me understand the Shopify response?",
      intro: "Send us the question with enough detail to reproduce or understand the situation.",
      primary: "Send message",
    },
  } as const;

  const activeModal = openModal ? modalContent[openModal] : null;

  const closeModal = () => {
    setOpenModal(null);
    setSubject("");
    setMessage("");
    setEmail("");
  };

  const submitForm = () => {
    if (!activeModal || !message.trim()) return;

    const formData = new FormData();
    formData.set("type", activeModal.type);
    formData.set("subject", subject || activeModal.title);
    formData.set("message", message);
    formData.set("email", email);
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Page title="Help, customization & contact" subtitle="Get expert help for Shopify redirect cleanup">
      <BlockStack gap="500">
        {justSucceeded ? (
          <Banner tone="success" title="Message sent">
            {result.message}
          </Banner>
        ) : null}

        {result?.ok === false && fetcher.state === "idle" ? (
          <Banner tone="critical" title="Could not send message">
            {result.message}
          </Banner>
        ) : null}

        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid #d7e5df",
            background:
              "linear-gradient(135deg, #0f2f2c 0%, #173f3a 63%, #f3efe2 63.2%, #fffaf0 100%)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(360px, .75fr)",
              gap: 40,
              padding: 28,
              alignItems: "center",
            }}
          >
            <div style={{ color: "#ffffff" }}>
              <BlockStack gap="400">
              <InlineStack gap="150" wrap>
                <Badge tone="success">Shopify professionals</Badge>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 28,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,.12)",
                  color: "#e8fff2",
                  fontSize: 13,
                  fontWeight: 550,
                }}>
                  Private workflows
                </span>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 28,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,.12)",
                  color: "#e8fff2",
                  fontSize: 13,
                  fontWeight: 550,
                }}>
                  Custom app development
                </span>
              </InlineStack>
              <BlockStack gap="200">
                <Text variant="heading2xl" as="h1">
                  Make Redirect Mapper Lite fit your store.
                </Text>
                <div style={{ maxWidth: 620, color: "#d8eee8" }}>
                  <Text variant="bodyLg" as="p">
                    We can adapt the app to your catalog, team process, and Shopify setup:
                    custom rules, richer filters, migration workflows, integrations, and store-specific automations.
                  </Text>
                </div>
              </BlockStack>
              <InlineStack gap="200">
                <Button variant="primary" size="large" onClick={() => setOpenModal("customization")}>
                  Request customization
                </Button>
                <Button size="large" onClick={() => setOpenModal("support")}>
                  Contact us
                </Button>
              </InlineStack>
              </BlockStack>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid rgba(15,47,44,.12)",
                borderRadius: 10,
                padding: 18,
                boxShadow: "0 14px 35px rgba(15,47,44,.14)",
              }}
            >
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "#dff7ea",
                      color: "#0c5132",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon source={MagicIcon} />
                  </div>
                  <BlockStack gap="050">
                    <Text variant="headingSm" as="h2">
                      Popular custom work
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Practical Shopify improvements with clear business value.
                    </Text>
                  </BlockStack>
                </InlineStack>
                <Divider />
                {[
                  "Redirect logic based on sales, traffic, inventory, and collections",
                  "Bulk cleanup flows for seasonal launches or brand exits",
                  "Private Shopify tools for catalog, SEO, or operations teams",
                ].map((item) => (
                  <InlineStack key={item} gap="200" blockAlign="start" wrap={false}>
                    <span style={{ color: "#0c5132", fontWeight: 700, lineHeight: "20px" }}>✓</span>
                    <Text variant="bodyMd" as="span">
                      {item}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
          {requestCards.map((card) => (
            <Card key={card.title}>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 9,
                      background: card.tone === "primary" ? "#dff7ea" : "#eef2ff",
                      color: card.tone === "primary" ? "#0c5132" : "#273a8a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon source={card.icon} />
                  </div>
                  <Text variant="headingMd" as="h2">
                    {card.title}
                  </Text>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued" as="p">
                  {card.text}
                </Text>
                <Button
                  variant={card.tone === "primary" ? "primary" : undefined}
                  onClick={() => setOpenModal(card.modal)}
                >
                  {card.action}
                </Button>
              </BlockStack>
            </Card>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.35fr .65fr", gap: 16 }}>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text variant="headingLg" as="h2">
                  What our Shopify team can customize
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p">
                  Keep the app simple for everyday use, and add the exact behavior your store needs behind the scenes.
                </Text>
              </BlockStack>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
                {customizationServices.map((service) => (
                  <Box key={service.title} padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <div style={{ width: 28, height: 28, color: "#16433f" }}>
                        <Icon source={service.icon} />
                      </div>
                      <Text variant="headingSm" as="h3">
                        {service.title}
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {service.text}
                      </Text>
                    </BlockStack>
                  </Box>
                ))}
              </div>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <div style={{ width: 32, height: 32, color: "#16433f" }}>
                  <Icon source={EmailIcon} />
                </div>
                <Text variant="headingMd" as="h2">
                  Direct contact
                </Text>
              </InlineStack>
              <Text variant="bodyMd" tone="subdued" as="p">
                Prefer email? Send us context about the store, the cleanup problem, and the result you want.
              </Text>
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: "#f7f5ee",
                  border: "1px solid #e4ddc8",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  overflowWrap: "anywhere",
                }}
              >
                {CONTACT_EMAIL}
              </div>
              <Button onClick={() => setOpenModal("support")}>Send from app</Button>
            </BlockStack>
          </Card>
        </div>

        <Modal
          open={Boolean(activeModal)}
          onClose={closeModal}
          title={activeModal?.title ?? ""}
          primaryAction={{
            content: isSubmitting ? "Sending..." : activeModal?.primary ?? "Send",
            disabled: !message.trim() || isSubmitting,
            loading: isSubmitting,
            onAction: submitForm,
          }}
          secondaryActions={[{ content: "Cancel", onAction: closeModal }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text variant="bodyMd" tone="subdued" as="p">
                {activeModal?.intro}
              </Text>
              <TextField
                label={activeModal?.messageLabel ?? "Message"}
                value={message}
                onChange={setMessage}
                multiline={5}
                placeholder={activeModal?.messagePlaceholder}
                autoComplete="off"
              />
              <TextField
                label="Subject"
                value={subject}
                onChange={setSubject}
                placeholder={activeModal?.subjectPlaceholder}
                autoComplete="off"
              />
              <TextField
                label="Reply email"
                value={email}
                onChange={setEmail}
                type="email"
                placeholder="you@store.com"
                autoComplete="email"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
