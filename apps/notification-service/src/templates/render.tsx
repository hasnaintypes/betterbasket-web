import { renderToStaticMarkup } from "react-dom/server";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import {
  TemplateDataSchema,
  templateLinks,
  type TemplateData,
  type TemplateOrigins,
} from "./model";

interface MessageContent {
  subject: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  action: string;
  href: string;
  itemLines?: string[];
}

const MAX_VISIBLE_ITEMS = 20;

function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(minor: number, currency: "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

function content(data: TemplateData, links: ReturnType<typeof templateLinks>): MessageContent {
  switch (data.kind) {
    case "order-confirmation": {
      const visible = data.items
        .slice(0, MAX_VISIBLE_ITEMS)
        .map(
          (item) =>
            `${oneLine(item.name)} × ${item.quantity} — ${money(item.quantity * item.unitPriceMinor, data.currency)}`,
        );
      if (data.items.length > MAX_VISIBLE_ITEMS) {
        visible.push(`And ${data.items.length - MAX_VISIBLE_ITEMS} more items`);
      }
      return {
        subject: "Your BetterBasket order is confirmed",
        heading: "Order confirmed",
        greeting: `Hi ${oneLine(data.customerName)},`,
        paragraphs: [
          `We received order ${data.orderId}. Your receipt is below.`,
          `Order total: ${money(data.totalMinor, data.currency)}`,
        ],
        itemLines: visible,
        action: "View your order",
        href: links.buyer,
      };
    }
    case "payment-failed":
      return {
        subject: "Payment needs attention",
        heading: "Payment did not complete",
        greeting: `Hi ${oneLine(data.customerName)},`,
        paragraphs: [
          `We could not complete payment for order ${data.orderId}. Please review the order and try again.`,
        ],
        action: "Review your order",
        href: links.buyer,
      };
    case "order-shipped":
      return {
        subject: "Your order has shipped",
        heading: "On its way",
        greeting: `Hi ${oneLine(data.customerName)},`,
        paragraphs: [
          `Order ${data.orderId} has shipped.`,
          ...(data.carrier ? [`Carrier: ${oneLine(data.carrier)}`] : []),
          ...(data.trackingNumber ? [`Tracking number: ${oneLine(data.trackingNumber)}`] : []),
        ],
        action: "View your order",
        href: links.buyer,
      };
    case "order-delivered":
      return {
        subject: "Your order was delivered",
        heading: "Delivered",
        greeting: `Hi ${oneLine(data.customerName)},`,
        paragraphs: [`Order ${data.orderId} was marked as delivered. We hope you enjoy it.`],
        action: "View your order",
        href: links.buyer,
      };
    case "order-cancelled":
      return {
        subject: "Your order was cancelled",
        heading: "Order cancelled",
        greeting: `Hi ${oneLine(data.customerName)},`,
        paragraphs: [
          `Order ${data.orderId} was cancelled. You can view its status in your account.`,
        ],
        action: "View your order",
        href: links.buyer,
      };
    case "refund-issued":
      return {
        subject: "A refund was issued",
        heading: "Refund issued",
        greeting: `Hi ${oneLine(data.customerName)},`,
        paragraphs: [
          `A refund of ${money(data.amountMinor, data.currency)} was issued for order ${data.orderId}.`,
          "Your payment provider determines when the funds appear in your account.",
        ],
        action: "View your order",
        href: links.buyer,
      };
    case "seller-new-order":
      return {
        subject: "A new order is ready for your store",
        heading: "New order",
        greeting: `Hello ${oneLine(data.storeName)},`,
        paragraphs: [`Order ${data.orderId} is ready for your review.`],
        action: "Review the order",
        href: links.seller,
      };
    case "seller-approved":
      return {
        subject: "Your store is approved",
        heading: "Store approved",
        greeting: `Hello ${oneLine(data.storeName)},`,
        paragraphs: ["Your store has been approved. Visit the seller portal to continue setup."],
        action: "Open seller portal",
        href: links.seller,
      };
    case "seller-suspended":
      return {
        subject: "Your store has been suspended",
        heading: "Store suspended",
        greeting: `Hello ${oneLine(data.storeName)},`,
        paragraphs: [
          "Your store has been suspended. New listings and orders are unavailable while this is reviewed.",
          "Visit the seller portal for your current status.",
        ],
        action: "Open seller portal",
        href: links.seller,
      };
  }
}

function TemplateDocument({ message }: { message: MessageContent }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{message.subject}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: "#f8fafc",
          color: "#0f172a",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <Container
          style={{ margin: "32px auto", maxWidth: 600, padding: 24, backgroundColor: "#ffffff" }}
        >
          <Heading as="h1" style={{ fontSize: 24, lineHeight: "32px", color: "#0f172a" }}>
            {message.heading}
          </Heading>
          <Text>{message.greeting}</Text>
          {message.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={{ fontSize: 16, lineHeight: "24px" }}>
              {paragraph}
            </Text>
          ))}
          {message.itemLines ? (
            <Section aria-label="Receipt items">
              {message.itemLines.map((line, index) => (
                <Text key={index} style={{ fontSize: 14, lineHeight: "21px" }}>
                  {line}
                </Text>
              ))}
            </Section>
          ) : null}
          <Text>
            <Link href={message.href} style={{ color: "#1d4ed8", fontWeight: "bold" }}>
              {message.action}
            </Link>
          </Text>
          <Text style={{ fontSize: 12, color: "#475569" }}>BetterBasket transactional notice</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function renderTemplate(data: TemplateData, config: TemplateOrigins) {
  const parsed = TemplateDataSchema.parse(data);
  const links = templateLinks(config, "orderId" in parsed ? parsed.orderId : undefined);
  const message = content(parsed, links);
  const html = renderToStaticMarkup(<TemplateDocument message={message} />);
  const text = [
    message.heading,
    "",
    message.greeting,
    "",
    ...message.paragraphs.flatMap((paragraph) => [oneLine(paragraph), ""]),
    ...(message.itemLines ? [...message.itemLines.map(oneLine), ""] : []),
    `${message.action}: ${message.href}`,
    "",
    "BetterBasket transactional notice",
  ].join("\n");
  return { subject: message.subject, html, text };
}
