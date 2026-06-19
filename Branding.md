# Organization Branding & White-Label Module

## Purpose

One of the biggest advantages of a SaaS CRM is allowing every customer (tenant) to feel like they own the software.

Instead of feeling like they are using **Sirah CRM**, every organization should feel like they are using **their own CRM**.

Example:

* ABC Hospital CRM
* XYZ Construction CRM
* Bright Future Academy CRM
* Elite Real Estate CRM

This module enables every tenant to customize the appearance, branding, terminology, and experience of the CRM without affecting other tenants.

---

# Objectives

* Give every tenant a unique brand identity.
* Improve customer trust and adoption.
* Support white-label deployments.
* Keep branding isolated per tenant.
* Ensure changes automatically reflect for every user within the tenant.

---

# Module Name

**Organization Branding & White Label**

---

# Level 1 — Company Branding (MVP)

## Company Logo

Allows the tenant admin to upload their company logo.

Used in:

* Login page
* Sidebar
* Top Navigation
* Dashboard
* PDF Quotations
* Reports
* Emails
* Future Customer Portal

---

## Favicon

Allows uploading a browser favicon.

Example:

Before

```
Sirah CRM
```

After

```
ABC Hospital CRM
```

Browser tabs immediately feel company-specific.

---

## Company Name

Displayed throughout the CRM.

Example:

```
ABC Hospital CRM
```

instead of

```
Sirah CRM
```

---

## Browser Title

Custom browser tab title.

Example:

```
ABC Hospital CRM
```

---

## Loader Logo

Logo shown while the application loads.

---

# Level 2 — Theme & Appearance

## Primary Color

Controls

* Buttons
* Links
* Active Sidebar
* Charts
* Progress Bars
* Toggles
* Status Indicators

---

## Secondary / Accent Color

Used for

* Badges
* Highlights
* Notifications
* Secondary Buttons

---

## Sidebar Theme

Options

* Dark
* Light
* Auto

---

## Navigation Style

Tenant can choose

* Classic Sidebar
* Collapsed Sidebar
* Top Navigation
* Hybrid Navigation

---

## Border Radius

Options

* Square
* Rounded
* Modern Rounded

---

## Density

Options

* Compact
* Comfortable
* Spacious

---

## Font Family

Options

* Inter
* Roboto
* Poppins
* Open Sans

---

# Level 3 — Login Experience

Tenant Admin can customize:

* Login Logo
* Background Image
* Welcome Message
* Company Description

Example:

```
Welcome to ABC Hospital CRM

Delivering Better Patient Care
```

---

# Level 4 — Dashboard Customization

Tenant admins can configure the default dashboard.

Users can arrange widgets such as:

* Revenue
* Leads
* Deals
* Tasks
* Calendar
* Activities
* Notifications
* Reports

Supports drag-and-drop widget arrangement.

---

# Level 5 — CRM Terminology

One of the strongest customization features.

Different industries use different terminology.

Instead of forcing everyone to use the same names, allow tenant admins to rename modules.

Example mappings:

| Default  | Hospital   | Education    | Real Estate | Recruitment |
| -------- | ---------- | ------------ | ----------- | ----------- |
| Leads    | Patients   | Students     | Buyers      | Candidates  |
| Contacts | Doctors    | Parents      | Owners      | Applicants  |
| Deals    | Treatments | Admissions   | Properties  | Placements  |
| Accounts | Hospitals  | Institutions | Agencies    | Clients     |

Changing a module name updates:

* Sidebar
* Headers
* Buttons
* Reports
* Dashboard
* Forms
* Notifications

without changing the underlying database.

---

# Level 6 — Module Visibility

Every business doesn't need every module.

Tenant admins can enable or disable modules.

Example:

Hospital

Enabled

* Leads
* Contacts
* Calendar
* Tasks

Disabled

* Products
* Quotations

---

Manufacturing

Enabled

* Products
* Quotations
* Inventory

Disabled

* Calendar

---

# Level 7 — Pipeline Customization

Every organization can build its own sales pipeline.

Example

Default

```
New

↓

Qualified

↓

Proposal

↓

Won
```

Hospital

```
Inquiry

↓

Appointment

↓

Consultation

↓

Treatment

↓

Completed
```

---

# Level 8 — Status Customization

Tenant-defined statuses.

Example

Instead of

```
New
```

Hospital may use

```
Patient Registered
```

---

# Level 9 — Custom Icons

Each module may have a custom icon.

Example

Hospital

🩺 Patients

Education

🎓 Students

Restaurant

🍔 Orders

---

# Level 10 — Email Branding

Emails automatically use:

* Company Logo
* Brand Colors
* Footer
* Signature
* Contact Information

instead of Sirah CRM branding.

---

# Level 11 — PDF Branding

Generated PDFs automatically include:

* Company Logo
* Colors
* Footer
* Watermark
* Contact Details

Applies to

* Quotations
* Invoices
* Reports
* Contracts

---

# Level 12 — Custom Domain (Future)

Instead of

```
crm.sirah.com
```

tenants can use

```
crm.abchospital.com
```

---

# Level 13 — AI Branding (Future)

Instead of

```
Sirah AI
```

organizations can rename it.

Examples

Hospital

```
Medi Assistant
```

Construction

```
Build AI
```

Restaurant

```
Chef Assistant
```

---

# Level 14 — Mobile Branding (Future)

Customize:

* App Name
* Splash Screen
* Logo
* Colors
* Icons

---

# Database Design

Recommended table:

```
organization_branding
```

Suggested fields

```
tenant_id

company_name

logo_url

favicon_url

primary_color

secondary_color

font_family

sidebar_theme

navigation_style

border_radius

density

login_background_url

welcome_message

browser_title

module_labels (JSONB)

module_visibility (JSONB)

dashboard_layout (JSONB)

status_labels (JSONB)

pipeline_settings (JSONB)

pdf_settings (JSONB)

email_settings (JSONB)

created_at

updated_at
```

---

# Permissions

Only Tenant Admins can modify branding.

Managers

❌ Cannot modify

Sales Representatives

❌ Cannot modify

Every user under the tenant automatically receives the updated branding.

---

# Runtime Flow

```
Tenant Admin

↓

Update Branding

↓

Save Settings

↓

Database

↓

Realtime Update

↓

Every Employee

↓

Logo

↓

Colors

↓

Sidebar

↓

Dashboard

↓

Browser Title

↓

PDF

↓

Emails

↓

Everything reflects instantly
```

---

# Benefits

* Creates a true white-label CRM experience.
* Improves customer ownership and trust.
* Reduces churn by making the CRM feel native to the organization.
* Supports multiple industries without separate codebases.
* Makes the platform suitable for enterprise deployments.

---

# Future Enhancements

* Custom Domains
* AI Assistant Branding
* Mobile App Branding
* Advanced Theme Builder
* CSS Theme Editor
* Marketplace for Themes
* Multiple Branding Profiles
* Seasonal Themes
* Department-specific Branding

---

# Priority

Recommended implementation order:

```
Organization Branding

↓

Billing

↓

AI Assistant

↓

Advanced Integrations

↓

Marketplace
```

This module is a strategic differentiator that elevates the CRM from a standard multi-tenant application to a true white-label SaaS platform, enabling every customer to feel they own a dedicated CRM tailored to their brand and business.
