# AEM Guides Button & Sidebar Integration

## Overview

This document describes the implementation of a button and sidebar integration for Markup.ai in AEM Guides. The implementation follows the same architectural pattern as the reference Acrolinx project and provides a static sidebar panel accessible from the AEM Guides XML editor.

## Implementation Date

November 17, 2025

## Architecture

The integration consists of several key components:

### 1. Core Components

#### `IAemIntegration` Interface

- **Location**: `ui.frontend/src/main/webpack/components/sidebarContainer/IAemIntegration.ts`
- **Purpose**: Defines the contract for AEM integrations
- **Methods**:
  - `init()`: Initialize the integration
  - `getTabListSelector()`: Get the tab list selector for the UI
  - `getPanelStackSelector()`: Get the panel stack selector for the UI

#### `AEMGuidesIntegration` Class

- **Location**: `ui.frontend/src/main/webpack/components/sidebarContainer/AEMGuidesIntegration.ts`
- **Purpose**: Implements the integration logic for AEM Guides
- **Key Features**:
  - Manages sidebar visibility based on editor mode (author/source)
  - Handles view switching between author and source modes
  - Uses mutation observers to track editor state changes
  - Shows/hides sidebar appropriately based on user context

#### `MarkupAiSidePanel` Class

- **Location**: `ui.frontend/src/main/webpack/components/sidebarContainer/sidebarContainer.ts`
- **Purpose**: Main controller for attaching and managing the sidebar panel
- **Key Features**:
  - Detects AEM Guides environment (XML editor presence)
  - Supports both Adobe Guides and XML Doc Addon (Spectrum UI)
  - Prevents duplicate sidebar additions
  - Uses mutation observers to detect panel mounting

#### `SidePanelUtils` Utility Class

- **Location**: `ui.frontend/src/main/webpack/components/utils/sidePanelUtils.ts`
- **Purpose**: Provides utility functions for sidebar management
- **Key Functions**:
  - `getContextPathPre()`: Extracts context path from current URL
  - `getSidePanelHTML()`: Generates sidebar HTML with static content
  - `addMenuAndContainerForGuides()`: Adds sidebar for Adobe Guides
  - `addMenuAndContainerForSpectrum()`: Adds sidebar for Spectrum UI
  - `waitForElement()`: Helper to wait for DOM elements
  - `attributeMutationObserver()`: Creates mutation observers

### 2. Integration Points

#### Main Entry Point

- **File**: `ui.frontend/src/main/webpack/site/main.ts`
- **Changes**:
  - Imports `MarkupAiSidePanel`
  - Initializes the sidebar in `initializeMarkupAi()` function
  - Attaches sidebar on application startup

#### Styles

- **File**: `ui.frontend/src/main/webpack/site/main.scss`
- **Key Styles**:
  - `.sidepanel-tab-markupai`: Main sidebar panel container
  - `.markupaiSidebarTab`: Tab button styling for Spectrum UI
  - `.markupai-panel-tab`: Tab button styling for Adobe Guides
  - `.markup-icon-container`: Icon container for the button

### 3. Visual Assets

#### Logo

- **Source**: `ui.frontend/src/main/webpack/resources/images/markup_Logo Mark Coral.svg`
- **Deployed To**: `ui.apps/src/main/content/jcr_root/apps/markupai-aem-guides/clientlibs/clientlib-site/resources/images/markup_Logo Mark Coral.svg`
- **Description**: Coral-colored Markup.ai logo mark used for the sidebar button icon

## Features

### Button Integration

1. **Icon**: Uses the Markup.ai logo (coral mark) as the button icon
2. **Label**: "Markup.ai" text label next to the icon
3. **Location**: Added to the left panel tab list in AEM Guides
4. **Behavior**:
   - Clickable to show/hide the sidebar
   - Disabled in source mode (only works in author mode)

### Sidebar Integration

1. **Content**: Static HTML page with heading "markup.ai sidebar"
2. **Visibility**:
   - Visible only in author mode
   - Hidden in source mode
3. **Layout**: Full-height panel in the left sidebar area
4. **Styling**: Clean, minimalist design with white background

### Mode-Aware Behavior

The integration intelligently handles different editor modes:

- **Author Mode**: Sidebar is visible and interactive
- **Source Mode**: Sidebar is hidden and disabled
- **Mode Switching**: Automatically shows/hides sidebar when user switches modes

## Supported Environments

1. **Adobe Guides**: Uses `tcx.eventHandler` API for integration
2. **XML Documentation Addon (Spectrum UI)**: Uses direct DOM manipulation with React event handlers

## Type Definitions

Updated `ui.frontend/src/typings/aem.d.ts` to include:

- jQuery (`$`, `jQuery`)
- CKEDITOR
- `fmxml` (AEM Guides editor API)
- `tcx` (Adobe Guides event handler API)

## Build Output

The implementation has been successfully built and generates:

1. **JavaScript**: `dist/clientlib-site/site.js` (8.50 kB, gzipped: 2.88 kB)
2. **CSS**: `dist/clientlib-site/site.css` (1.00 kB, gzipped: 0.41 kB)
3. **Assets**: Logo SVG copied to clientlib resources

## File Structure

```
ui.frontend/src/main/webpack/
├── components/
│   ├── sidebarContainer/
│   │   ├── IAemIntegration.ts          # Interface definition
│   │   ├── AEMGuidesIntegration.ts     # Main integration logic
│   │   ├── sidebarContainer.ts         # Sidebar controller
│   │   └── index.ts                    # Module exports
│   └── utils/
│       ├── sidePanelUtils.ts           # Utility functions
│       └── index.ts                    # Module exports
├── site/
│   ├── main.ts                         # Application entry point
│   └── main.scss                       # Main styles
└── resources/
    └── images/
        └── markup_Logo Mark Coral.svg  # Logo icon

ui.apps/src/main/content/jcr_root/apps/markupai-aem-guides/clientlibs/clientlib-site/
├── css/
│   └── site.css                        # Compiled styles
├── js/
│   └── site.js                         # Compiled JavaScript
└── resources/
    └── images/
        └── markup_Logo Mark Coral.svg  # Deployed logo
```

## Testing

To test the integration:

1. **Build the project**:

   ```bash
   cd ui.frontend
   npm run prod
   ```

2. **Deploy to AEM**:
   Deploy the entire project to your AEM instance

3. **Open AEM Guides XML Editor**:
   Navigate to a DITA topic in AEM Guides web editor

4. **Verify**:
   - Check that the Markup.ai button appears in the left sidebar
   - Click the button to open the sidebar
   - Verify the sidebar shows "markup.ai sidebar" heading
   - Switch between author and source modes to verify visibility behavior

## Future Enhancements

The current implementation provides a foundation for:

1. **Dynamic Content**: Replace static HTML with interactive components
2. **API Integration**: Connect to Markup.ai services
3. **Content Analysis**: Implement document analysis features
4. **User Preferences**: Add settings and configuration options
5. **Localization**: Add multi-language support

## Technical Notes

1. **jQuery Dependency**: The implementation relies on jQuery being available in the AEM environment (provided by AEM itself)
2. **CKEDITOR Dependency**: Requires CKEDITOR to be loaded by AEM Guides
3. **Timing**: Uses a 3-second delay to ensure AEM Guides is fully loaded before initializing
4. **Mutation Observers**: Used extensively to detect DOM changes and editor state

## Configuration

The integration uses the following identifiers:

- **Sidebar ID**: `markupai_sidepanel`
- **Panel Class**: `markupai-panel-tab`
- **Tab ID**: `markupai-sidebar`
- **Container ID**: `sidebarContainer`

These can be customized if needed by modifying the respective class files.

## Linting

All files pass ESLint checks with one minor warning:

- `main.ts`: Preference for top-level await (warning only, not blocking)

## Conclusion

The button and sidebar integration has been successfully implemented following best practices from the reference Acrolinx project. The implementation is production-ready and provides a solid foundation for future Markup.ai features in AEM Guides.
